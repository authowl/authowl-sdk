import type {
  AuthActionResult,
  AuthSession,
  SessionStore,
  AuthUser,
  SessionState,
} from './client';
import type { AuthHttpClient } from './http-client';
import { asRecord, decodeAuthSession, decodeAuthUser, invalidResponse } from './response-schema';
import type { SessionRead, SessionTokenStore } from './session-token';

type SessionData = { session: AuthSession; user: AuthUser };
type SessionQuery = { query?: { disableCookieCache?: boolean } };

export interface SessionController {
  store: SessionStore;
  getSession(options?: SessionQuery): Promise<AuthActionResult<SessionData | null>>;
  notifyMutation(): void;
}

export type SessionControllerInput = {
  /** Every ordinary session read. Carries the session, whichever transport it is on. */
  http: AuthHttpClient;
  /**
   * The same endpoint with the session DETACHED. Exactly one caller: the cookie
   * measurement below, which is only a measurement because the token is absent.
   */
  probe: AuthHttpClient;
  /** The session lifecycle. Handed in, rather than looked up from an id. */
  tokens: SessionTokenStore;
  /** Cross-tab wake-up channel. A NAME, not a project id: they are different facts. */
  channelName: string;
};

export function createSessionController({
  http,
  probe,
  tokens,
  channelName,
}: SessionControllerInput): SessionController {
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | null = null;
  let detachBrowserListeners: (() => void) | null = null;
  let activeRequest: AbortController | null = null;
  /**
   * The idle refresh currently in flight, if any.
   *
   * The bearer transport carries NO cookie cache, by design on both sides:
   * ingress drops `session_data` and egress strips it, because a cache whose
   * HMAC verifies without ever being compared to the token presented would let a
   * jar holding one session's cache and another's token resolve as the wrong
   * user for five minutes. The consequence is that every session read on this
   * transport is a database read - and a tab regaining focus fires `focus` AND
   * `visibilitychange`, so the idle path arrives in pairs. Joining the one in
   * flight is strictly better than aborting it and paying for both, and it
   * cannot serve anything staler than a request that is still open.
   *
   * Deliberately NOT extended to the post-mutation refresh: that one must
   * supersede whatever was in flight, because a read that STARTED before the
   * mutation committed would answer with the state the mutation just replaced.
   */
  let idleRefresh: Promise<void> | null = null;
  /**
   * The cookie measurement in flight, if any.
   *
   * Two things ask for one, and they get different answers to "is there already
   * one running": see `measureCookieTransport` and the registration at the
   * bottom of this function.
   */
  let measurement: Promise<void> | null = null;
  let state: SessionState;

  const refetch = (options?: SessionQuery): void => {
    void refresh(options);
  };
  state = {
    data: null,
    isPending: true,
    isRefetching: false,
    error: null,
    refetch,
  };

  function emit(next: SessionState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  async function getSession(options?: SessionQuery): Promise<AuthActionResult<SessionData | null>> {
    return http.request<SessionData | null>('/get-session', {
      query: options?.query,
      decode: decodeSessionData,
    });
  }

  function refresh(options?: SessionQuery): Promise<void> {
    if (options?.query?.disableCookieCache === true) return runRefresh(options);
    if (idleRefresh) return idleRefresh;
    const running = runRefresh(options).finally(() => {
      if (idleRefresh === running) idleRefresh = null;
    });
    idleRefresh = running;
    return running;
  }

  async function runRefresh(options?: SessionQuery): Promise<void> {
    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    emit({
      ...state,
      isPending: state.data === null && state.error === null,
      isRefetching: state.data !== null,
    });
    // Cut BEFORE the request: `observe` may store a token mid-flight, so what
    // matters is whether THIS read carried one, and whether the token it carried
    // is still the session in play by the time the answer lands.
    const read = tokens.beginRead();
    const result = await http.request<SessionData | null>('/get-session', {
      query: options?.query,
      fetchOptions: { signal: request.signal },
      decode: decodeSessionData,
    });
    if (activeRequest !== request) return;
    // Release and emit BEFORE the measurement, and not after it.
    //
    // The guard above runs before `measureCookieTransport` is awaited, but the
    // deregistration and the emit used to run after it, unconditionally. A
    // mutation landing during the probe therefore had run A tear down run B's
    // registration and emit A's pre-mutation data, while B failed its own guard
    // and never emitted at all: a sign-out that resolved successfully while the
    // store went on rendering the signed-in user, `isPending: false`, until the
    // next focus event. The verdict is not session state and has no business
    // sitting between the read and the emit.
    activeRequest = null;
    emit({
      data: result.data,
      error: result.error,
      isPending: false,
      isRefetching: false,
      refetch,
    });
    if (result.error !== null) return;
    if (result.data === null) {
      // A read that PRESENTED a token and came back with no session proves the
      // token is dead: expired, revoked from another device, or the account
      // deleted. This is the path-independent catch for every session ending
      // that is not sign-out - `account.revokeSession` called with your own id,
      // `account.delete`, an admin ban - none of which the SDK can identify from
      // the response it gets back.
      //
      // Whether this answer is even ABOUT the session now in play is the
      // receipt's business, not this file's: the question needs the token value
      // and the session lifecycle, both of which live in the token store, and
      // splitting the rule across the two is how the guard came to be correct
      // within a tab and wrong across tabs. See `beginRead`.
      read.endIfDead();
      return;
    }
    await measureCookieTransport(read);
  }

  /**
   * Decide, once per session, whether our cross-site cookie survives here - by
   * reading the session with the token deliberately detached.
   *
   * Once per SESSION rather than once per browser, because the browser is not a
   * constant: Safari shipped CHIPS in 18.4 and removed it in a point release.
   * `beginSession` re-arms the question at every minting door; see the header of
   * `session-token.ts` for what a permanent answer cost.
   *
   * A read that never carried a token IS the measurement, so the common case
   * costs no extra request. Only a read that leaned on the token needs a second
   * one, and only until the answer is known.
   *
   * This is the SECOND door into the measurement and no longer the one that
   * matters most: the mint asks for it directly (see the registration below), so
   * by the time a subscribed app gets here the answer is usually in. What this
   * door still covers is the reading that costs nothing - a token-free read that
   * found a session - and a browser whose mint-time probe failed on the network.
   *
   * A transport failure records nothing: "the network blipped" and "this browser
   * drops our cookie" are different facts, and treating the first as the second
   * would strand a Chrome user on the token path permanently.
   */
  async function measureCookieTransport(read: SessionRead): Promise<void> {
    if (!tokens.needsProbe()) return;
    if (!read.carriedToken) {
      read.recordCookieVerdict(true);
      return;
    }
    // JOIN whatever is already running, unlike the mint below. This caller has
    // no news - it is reporting that a read leaned on the token, which is the
    // same session and the same question a probe in flight is already asking -
    // and each probe is a deliberately cache-defeating database read. The pair
    // is routine: the mint fires one, and the refresh the same mint triggers
    // arrives here a moment later.
    if (measurement) return measurement;
    return probeCookieTransport(read);
  }

  /**
   * Ask the browser the question directly: read the session with the token
   * detached, and let the receipt decide whether the answer still describes the
   * session it was asked about.
   */
  function probeCookieTransport(read: SessionRead): Promise<void> {
    const running: Promise<void> = probe
      .request<SessionData | null>('/get-session', {
        query: { disableCookieCache: true },
        decode: decodeSessionData,
      })
      .then((measured) => {
        // Superseded by a probe for a later session. The receipt would catch the
        // answer that matters most, but a stale probe has nothing to add either
        // way and the newer one is strictly better informed.
        if (measurement !== running) return;
        if (measured.error !== null) return;
        read.recordCookieVerdict(measured.data !== null);
      })
      .finally(() => {
        if (measurement === running) measurement = null;
      });
    measurement = running;
    return running;
  }

  /**
   * Wake the other tabs.
   *
   * The ping carries no credential, deliberately: a session token has no
   * business on a channel any script on this origin can listen to. It is a
   * wake-up, and the woken tab picks the token up out of storage itself - see
   * `currentToken` in `session-token.ts`. Which is also why WHEN it fires
   * matters: a tab woken before the token reaches storage finds nothing there.
   */
  function announce(): void {
    channel?.postMessage({ type: 'session-changed' });
  }

  function attachBrowserEvents(): void {
    if (typeof window === 'undefined' || detachBrowserListeners) return;
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(channelName);
      channel.addEventListener('message', onFocus);
    }
    detachBrowserListeners = () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.close();
      channel = null;
      detachBrowserListeners = null;
    };
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
      attachBrowserEvents();
      void refresh();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        const abandoned = activeRequest;
        activeRequest = null;
        // The in-flight request belongs to a subscription lifetime that just
        // ended. Do not let an immediate resubscribe join that abandoned
        // promise: React Strict Mode intentionally performs exactly this
        // subscribe -> unsubscribe -> subscribe sequence in development. The
        // aborted run keeps its own promise and guard, while the new lifetime
        // is free to start a fresh read immediately.
        idleRefresh = null;
        abandoned?.abort();
        detachBrowserListeners?.();
      }
    };
  }

  // AT CONSTRUCTION, not at subscription, and that is the entire point of it.
  //
  // The store holds a captured token in memory and refuses to persist it until
  // this answers, so an integration that never mounts a session store - anything
  // server-rendered, anything headless - used to be the case that measured
  // never. It kept a durable script-readable token instead. A client being built
  // is the earliest moment anything can ask, and it does not depend on the host
  // app doing anything at all.
  tokens.measureWith(() => {
    if (!tokens.needsProbe()) return;
    // SUPERSEDE rather than join, and for availability rather than for safety.
    // A probe in flight was dispatched for the session that came BEFORE this
    // mint, and a sign-out plus a sign-in fits inside one round trip. Its answer
    // is already harmless: it records through the receipt it was cut for, whose
    // generation no longer matches, so `SessionRead.recordCookieVerdict` drops
    // it. What joining would cost is the QUESTION - it dispatches nothing, and
    // `measureNow` has already spent this mint's one ask - leaving the new
    // session unmeasured. The integration this registration exists for has no
    // second door, so that is a token never persisted and a session gone at the
    // next reload.
    void probeCookieTransport(tokens.beginRead());
  });

  return {
    store: {
      subscribe,
      getSnapshot: () => state,
    },
    getSession,
    notifyMutation() {
      announce();
      // And AGAIN once the measurement settles, because this broadcast now runs
      // AHEAD of the thing it is telling the other tabs to go read.
      //
      // The bearer gate moved "the token reaches shared storage" from capture
      // time to the verdict, a round trip later. The wake-up did not move with
      // it: it still fires when the action resolves, which used to be strictly
      // after the write. On a browser that needs the token the woken tab
      // therefore hydrates an empty slot, dispatches tokenless, gets null and
      // renders SIGNED OUT. Nothing is damaged - its snapshot is null, so
      // `endIfDead` no-ops - but nothing heals it either before a user sees it:
      // a visible-but-unfocused tab stays signed out until it is touched, and a
      // route-guard app navigates that background tab to /sign-in. A regression
      // on exactly the population this transport exists for.
      //
      // Both conditions are load-bearing, and both are asked at SETTLE time
      // rather than now. `hasToken` is what keeps a cookie-keeping browser from
      // paying a second `/get-session` in every open tab on every sign-in: its
      // verdict dropped the token, so there is nothing for a woken tab to find
      // and nothing to wake it for. `needsProbe` covers the probe that FAILED -
      // verdict still open, storage still empty - where a ping buys the other
      // tabs one anonymous read each and no session.
      //
      // The `catch` is not decoration. Nothing awaits this chain, so a rejection
      // anywhere in it surfaces as an unhandled rejection rather than as a
      // missed wake-up.
      if (measurement) {
        void measurement
          .catch(() => {})
          .then(() => {
            if (!tokens.needsProbe() && tokens.hasToken()) announce();
          });
      }
      if (listeners.size > 0) void refresh({ query: { disableCookieCache: true } });
    },
  };
}

function decodeSessionData(value: unknown): SessionData | null {
  if (value === null) return null;
  const row = asRecord(value);
  if (row.session === undefined || row.user === undefined) invalidResponse();
  return {
    session: decodeAuthSession(row.session),
    user: decodeAuthUser(row.user),
  };
}
