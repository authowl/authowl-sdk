import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthHttpClient } from './http-client';
import { createSessionController, type SessionControllerInput } from './session-store';
import { sessionTokenStore, SESSION_TOKEN_HEADER } from './session-token';

/**
 * A fresh project id per test.
 *
 * The token store is a module-level singleton per project, so a shared one would
 * let the first test's successful read record a cookie verdict that every later
 * test in the file then inherits - the order-dependent kind of failure that only
 * shows up once the suite is resequenced.
 */
let projects = 0;
const freshProject = () => `project-${(projects += 1)}`;

/**
 * A controller wired the way the client wires one, with the pieces a test cares
 * about swappable. `probe` defaults to the same stub as `http`: only the tests
 * about the measurement need them to differ.
 *
 * `projectId` is passed by the tests that need the TOKEN STORE in hand - to
 * capture a token before the controller exists, or to assert on the verdict
 * afterwards. `sessionTokenStore` is a singleton per project, so handing the id
 * in is what makes the store the test holds and the store the controller drives
 * the same object, without either of them restating the channel name.
 */
function controllerFor(
  request: AuthHttpClient['request'],
  overrides: Partial<SessionControllerInput> = {},
  projectId = freshProject(),
) {
  const http = { request } as AuthHttpClient;
  return createSessionController({
    http,
    probe: http,
    tokens: sessionTokenStore(projectId),
    channelName: `authowl:${projectId}`,
    ...overrides,
  });
}

describe('session external store', () => {
  it('loads on first subscription and durably refetches after a mutation', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: session('one'), error: null })
      .mockResolvedValueOnce({ data: session('two'), error: null });
    const controller = controllerFor(request as AuthHttpClient['request']);
    const listener = vi.fn();
    const unsubscribe = controller.store.subscribe(listener);

    await vi.waitFor(() => expect(controller.store.getSnapshot().data?.user.id).toBe('one'));
    expect(controller.store.getSnapshot().isPending).toBe(false);

    controller.notifyMutation();
    await vi.waitFor(() => expect(controller.store.getSnapshot().data?.user.id).toBe('two'));
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      query: { disableCookieCache: true },
    });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('returns the server envelope from one-shot getSession', async () => {
    const request = vi.fn().mockResolvedValue({ data: session('one'), error: null });
    const controller = controllerFor(request as AuthHttpClient['request']);
    await expect(
      controller.getSession({ query: { disableCookieCache: true } }),
    ).resolves.toMatchObject({ data: { user: { id: 'one' } }, error: null });
  });

  it('explicitly refreshes past the cookie cache and notifies subscribers', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: session('one'), error: null })
      .mockResolvedValueOnce({ data: session('two'), error: null });
    const controller = controllerFor(request as AuthHttpClient['request']);
    const listener = vi.fn();
    const unsubscribe = controller.store.subscribe(listener);

    await vi.waitFor(() => expect(controller.store.getSnapshot().data?.user.id).toBe('one'));
    listener.mockClear();

    await controller.store.refresh();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      query: { disableCookieCache: true },
    });
    expect(controller.store.getSnapshot().data?.user.id).toBe('two');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('does not join an abandoned store refresh after a resubscribe', async () => {
    // React Strict Mode performs subscribe -> unsubscribe -> subscribe in
    // development, which aborts the in-flight read. A store refresh started
    // before that must not be handed to the new lifetime: the new subscription
    // would join a promise for a request that was already abandoned, and so
    // never re-read the session at all.
    const request = vi.fn().mockResolvedValue({ data: session('one'), error: null });
    const controller = controllerFor(request as AuthHttpClient['request']);
    const unsubscribe = controller.store.subscribe(vi.fn());
    await vi.waitFor(() => expect(controller.store.getSnapshot().data?.user.id).toBe('one'));

    void controller.store.refresh();
    unsubscribe();
    const callsBeforeResubscribe = request.mock.calls.length;

    const resubscribe = controller.store.subscribe(vi.fn());
    await vi.waitFor(() =>
      expect(request.mock.calls.length).toBeGreaterThan(callsBeforeResubscribe),
    );
    resubscribe();
  });

  it('shares one request between concurrent explicit refreshes', async () => {
    let resolveRequest!: (value: unknown) => void;
    const request = vi.fn(
      (_path: string, _options?: unknown) =>
        new Promise((resolve) => { resolveRequest = resolve; }),
    );
    const controller = controllerFor(request as unknown as AuthHttpClient['request']);

    const first = controller.store.refresh();
    const second = controller.store.refresh();

    expect(first).toBe(second);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      query: { disableCookieCache: true },
    });

    resolveRequest({ data: null, error: null });
    await Promise.all([first, second]);
  });

  it('joins a duplicate idle refresh instead of paying for a second database read', async () => {
    // A tab regaining focus fires `focus` AND `visibilitychange`. The bearer
    // transport carries no cookie cache - by design, on both sides - so every
    // session read is a database read and the pair costs double.
    const deferred: ((value: unknown) => void)[] = [];
    const request = vi.fn(() => new Promise((resolve) => deferred.push(resolve)));
    const controller = controllerFor(request as unknown as AuthHttpClient['request']);
    const unsubscribe = controller.store.subscribe(() => {});

    controller.store.getSnapshot().refetch();
    controller.store.getSnapshot().refetch();

    expect(request).toHaveBeenCalledTimes(1);
    deferred.forEach((resolve) => resolve({ data: session('one'), error: null }));
    await vi.waitFor(() => expect(controller.store.getSnapshot().isPending).toBe(false));
    unsubscribe();
  });

  it('starts a fresh load when React Strict Mode immediately resubscribes', async () => {
    // Strict Mode mounts an external-store subscription, tears it down, and
    // mounts it again. The first lifetime aborts its read. If that abandoned
    // promise remains registered as the shared idle refresh, the second
    // lifetime joins it, receives no emit, and stays `isPending` forever until
    // an unrelated focus event happens to retry the session.
    const release: Array<(value: unknown) => void> = [];
    const request = vi.fn(() => new Promise((resolve) => release.push(resolve)));
    const controller = controllerFor(request as unknown as AuthHttpClient['request']);

    const unsubscribeFirst = controller.store.subscribe(() => {});
    expect(request).toHaveBeenCalledTimes(1);
    unsubscribeFirst();

    const unsubscribeSecond = controller.store.subscribe(() => {});
    expect(request).toHaveBeenCalledTimes(2);

    // Let the abandoned response arrive after the live one has started. Its
    // active-request guard must keep it from overwriting the current lifetime.
    release[0]?.({ data: session('stale'), error: null });
    release[1]?.({ data: session('current'), error: null });

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().data?.user.id).toBe('current');
    });
    expect(controller.store.getSnapshot().isPending).toBe(false);
    unsubscribeSecond();
  });

  it('still supersedes an in-flight read after a mutation', async () => {
    // The opposite rule, and the reason coalescing stops at the idle path: a
    // read that STARTED before the mutation committed would answer with the
    // state the mutation just replaced.
    const request = vi.fn((_path: string, _options?: unknown) => new Promise(() => {}));
    const controller = controllerFor(request as unknown as AuthHttpClient['request']);
    const unsubscribe = controller.store.subscribe(() => {});

    controller.store.getSnapshot().refetch();
    controller.notifyMutation();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toMatchObject({ query: { disableCookieCache: true } });
    unsubscribe();
  });

  it('lets a mutation land DURING the cookie measurement without losing it', async () => {
    // The measurement is not session state and has no business between the read
    // and the emit. When it sat there, a mutation arriving mid-probe had the
    // finished read deregister the superseding one and emit its own pre-mutation
    // data - so a sign-out resolved successfully while the store went on
    // rendering the signed-in user, `isPending: false`, until the next focus.
    const projectId = freshProject();
    const tokens = sessionTokenStore(projectId);
    tokens.observe(new Headers({ [SESSION_TOKEN_HEADER]: 'tok.sig' }));

    let releaseProbe!: (value: unknown) => void;
    const probeRequest = vi.fn(() => new Promise((resolve) => { releaseProbe = resolve; }));
    // The superseding read must still be IN FLIGHT when the probe finishes:
    // that is the whole race. Resolving it earlier lets it emit before the
    // finished read deregisters it, and the bug hides.
    let releaseSuperseding!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: session('one'), error: null })
      .mockImplementation(() => new Promise((resolve) => { releaseSuperseding = resolve; }));
    const controller = createSessionController({
      http: { request } as unknown as AuthHttpClient,
      probe: { request: probeRequest } as unknown as AuthHttpClient,
      tokens,
      channelName: `authowl:${projectId}`,
    });
    const unsubscribe = controller.store.subscribe(() => {});

    // The read carried a token, so the verdict costs a second request - and that
    // is the window a mutation can land in.
    await vi.waitFor(() => expect(probeRequest).toHaveBeenCalledTimes(1));
    controller.notifyMutation();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    releaseProbe({ data: null, error: null });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    releaseSuperseding({ data: session('two'), error: null });

    await vi.waitFor(() => expect(controller.store.getSnapshot().data?.user.id).toBe('two'));
    expect(controller.store.getSnapshot().isPending).toBe(false);
    unsubscribe();
  });

  it('ends the session when a read that presented a token finds none', async () => {
    // The path-independent catch for every ending that is not sign-out: expiry,
    // a revoke from another device, `account.revokeSession` with your own id,
    // `account.delete`. None of those responses say whether the session that
    // ended was this one, but a token we PRESENTED and got nothing back for is
    // dead by definition - and left in storage it reads back on the next load as
    // a live session that signs the user out at the first request.
    const projectId = freshProject();
    const tokens = sessionTokenStore(projectId);
    tokens.beginSession({ remember: true });
    tokens.observe(new Headers({ [SESSION_TOKEN_HEADER]: 'expired.sig' }));

    const request = vi.fn().mockResolvedValue({ data: null, error: null });
    const controller = createSessionController({
      http: { request } as unknown as AuthHttpClient,
      probe: { request } as unknown as AuthHttpClient,
      tokens,
      channelName: `authowl:${projectId}`,
    });
    const unsubscribe = controller.store.subscribe(() => {});

    await vi.waitFor(() => expect(controller.store.getSnapshot().isPending).toBe(false));
    expect(tokens.hasToken()).toBe(false);
    unsubscribe();
  });

  it('measures the browser off the MINT, with nothing subscribed to the store', async () => {
    // The case the whole gate rests on. The token store now holds a captured
    // token in memory and refuses to write it until this answers, so an
    // integration that never mounts a session store - server-rendered, headless,
    // anything driving the client from its own state - would otherwise never
    // measure at all: a permanent durable token on browsers that keep cookies,
    // and no persistence at all on the browsers that do not.
    const projectId = freshProject();
    const tokens = sessionTokenStore(projectId);
    const probeRequest = vi.fn().mockResolvedValue({ data: null, error: null });
    const request = vi.fn();
    controllerFor(
      request as unknown as AuthHttpClient['request'],
      { probe: { request: probeRequest } as unknown as AuthHttpClient },
      projectId,
    );

    tokens.observe(new Headers({ [SESSION_TOKEN_HEADER]: 'tok.sig' }));

    await vi.waitFor(() => expect(tokens.needsProbe()).toBe(false));
    expect(probeRequest.mock.calls[0]?.[1]).toMatchObject({
      query: { disableCookieCache: true },
    });
    // The ordinary session read is untouched: nothing subscribed, so nothing
    // asked for one.
    expect(request).not.toHaveBeenCalled();
  });

  it('supersedes a probe left over from the session before this mint', async () => {
    // A sign-out and a fresh sign-in both fit inside one probe's round trip. The
    // stale probe's ANSWER cannot land either way - the supersede check drops
    // it, and the receipt it was cut under would drop it regardless, its
    // generation having moved twice - so what this pins is the other half: that
    // the NEW session gets a probe AT ALL. Joining would leave it with none,
    // because `measureNow` has already spent this mint's one ask, and an
    // integration that never subscribes has no second door: unmeasured, token
    // never written, session gone at the next reload.
    const projectId = freshProject();
    const tokens = sessionTokenStore(projectId);
    const release: ((value: unknown) => void)[] = [];
    const probeRequest = vi.fn(() => new Promise((resolve) => release.push(resolve)));
    controllerFor(
      vi.fn() as unknown as AuthHttpClient['request'],
      { probe: { request: probeRequest } as unknown as AuthHttpClient },
      projectId,
    );

    tokens.beginSession({ remember: true });
    tokens.observe(new Headers({ [SESSION_TOKEN_HEADER]: 'first.sig' }));
    await vi.waitFor(() => expect(probeRequest).toHaveBeenCalledTimes(1));
    tokens.endSession();
    tokens.beginSession({ remember: true });
    tokens.observe(new Headers({ [SESSION_TOKEN_HEADER]: 'second.sig' }));

    await vi.waitFor(() => expect(probeRequest).toHaveBeenCalledTimes(2));
    // The stale probe answers first, describing the signed-out gap.
    release[0]?.({ data: null, error: null });
    // The live one answers the truth about the browser.
    release[1]?.({ data: session('one'), error: null });

    // `cookies`, not `bearer`: the live probe won. The token goes with it, which
    // is the whole point - there is no storage assertion here because this file
    // runs without one, and `session-transport.test.ts` pins the disk half
    // against a real jsdom `localStorage`.
    await vi.waitFor(() => expect(tokens.needsProbe()).toBe(false));
    expect(tokens.wantsToken()).toBe(false);
    expect(tokens.hasToken()).toBe(false);
  });

  describe('the cross-tab wake-up, which now runs ahead of the write', () => {
    afterEach(() => {
      // NOT covered by `vi.restoreAllMocks`. A leaked fake `window` would change
      // what `subscribe` does in every test that ran after this one.
      vi.unstubAllGlobals();
    });

    /**
     * Make the announcements observable.
     *
     * This file runs in the node environment, where `attachBrowserEvents` finds
     * no `window` and attaches nothing at all - so the channel a controller
     * announces on has to be stood up here. A fake rather than a real
     * `BroadcastChannel` because the assertion is a COUNT at a moment in time,
     * and a real one delivers asynchronously and never to its own sender.
     */
    function captureAnnouncements(): unknown[] {
      const posted: unknown[] = [];
      const noop = { addEventListener: () => {}, removeEventListener: () => {} };
      vi.stubGlobal('window', noop);
      vi.stubGlobal('document', noop);
      vi.stubGlobal(
        'BroadcastChannel',
        class {
          constructor(readonly name: string) {}
          postMessage(message: unknown): void {
            posted.push(message);
          }
          addEventListener(): void {}
          close(): void {}
        },
      );
      return posted;
    }

    /**
     * A sign-in with the mint's probe held open, so the test decides what this
     * browser answers about its cookies and when.
     *
     * The mint runs BEFORE the subscription deliberately: a subscription's first
     * read would otherwise carry no token, which IS a measurement, and the
     * verdict would settle as "cookies work" with no probe to hold.
     */
    function signInWithHeldProbe() {
      const posted = captureAnnouncements();
      const projectId = freshProject();
      const tokens = sessionTokenStore(projectId);
      let releaseProbe!: (value: unknown) => void;
      const probeRequest = vi.fn(
        () =>
          new Promise((resolve) => {
            releaseProbe = resolve;
          }),
      );
      const request = vi.fn().mockResolvedValue({ data: session('one'), error: null });
      const controller = createSessionController({
        http: { request } as unknown as AuthHttpClient,
        probe: { request: probeRequest } as unknown as AuthHttpClient,
        tokens,
        channelName: `authowl:${projectId}`,
      });
      tokens.beginSession({ remember: true });
      tokens.observe(new Headers({ [SESSION_TOKEN_HEADER]: 'tok.sig' }));
      const unsubscribe = controller.store.subscribe(() => {});
      return {
        controller,
        tokens,
        posted,
        unsubscribe,
        release: (value: unknown) => releaseProbe(value),
      };
    }

    /** Let every pending microtask chain run out. */
    const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    it('wakes the other tabs AGAIN once the bearer session reaches storage', async () => {
      const { controller, posted, release, tokens, unsubscribe } = signInWithHeldProbe();

      // The action resolves and the store announces - which under the gate is
      // now BEFORE the write it is telling the other tabs to go and read, where
      // it used to be strictly after it.
      controller.notifyMutation();
      expect(posted).toHaveLength(1);

      // The probe finds no session without the token: the cookie is gone here,
      // so the token stops being a risk and becomes the only copy this browser
      // has, and only NOW does it reach shared storage.
      release({ data: null, error: null });

      // Without this second ping, the tab woken by the first one hydrates an
      // empty slot, dispatches tokenless, gets null and renders signed out. It
      // damages no state - its snapshot is null, so `endIfDead` no-ops - but it
      // does not heal before a user sees it either: a visible-but-unfocused tab
      // stays signed out until it is touched, and a route-guard app navigates
      // that background tab to /sign-in.
      await vi.waitFor(() => expect(posted).toHaveLength(2));
      expect(tokens.hasToken()).toBe(true);
      unsubscribe();
    });

    it('does not wake them twice on a browser that keeps the cookie', async () => {
      const { controller, posted, release, tokens, unsubscribe } = signInWithHeldProbe();

      controller.notifyMutation();
      expect(posted).toHaveLength(1);

      // The detached read found a session, so the cookie survives here: the
      // verdict drops the token and leaves nothing in storage for a woken tab to
      // find. A second ping would buy every open tab another `/get-session` - a
      // deliberately cache-defeating database read each - on every sign-in, for
      // a slot that is empty by design.
      release({ data: session('one'), error: null });

      await vi.waitFor(() => expect(tokens.needsProbe()).toBe(false));
      await settle();
      expect(tokens.hasToken()).toBe(false);
      expect(posted).toHaveLength(1);
      unsubscribe();
    });
  });

  it('provides a stable pending snapshot without fetching before subscription', () => {
    const request = vi.fn();
    const controller = controllerFor(request as AuthHttpClient['request']);
    const first = controller.store.getSnapshot();
    expect(first.isPending).toBe(true);
    expect(controller.store.getSnapshot()).toBe(first);
    expect(request).not.toHaveBeenCalled();
  });
});

function session(id: string) {
  const now = new Date();
  return {
    user: {
      id,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${id}`,
      userId: id,
      expiresAt: now,
    },
  };
}
