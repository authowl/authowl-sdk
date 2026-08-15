/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://app.tenant.test/sign-in" }
 *
 * A real DOM, not stubs: this module's whole job is cookie and history
 * semantics, and hand-rolled globals would let it pass for the wrong reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import { isBrowserRuntime } from './browser-runtime';
import {
  beginCrossSiteSignIn,
  challengeFor,
  completeCrossSiteSignIn,
  takeHandoffCode,
} from './session-handoff';
import { sessionTokenStore } from './session-token';

/**
 * The client half of the cross-site transport.
 *
 * The value of these tests is the WIRE: the server refuses a destination that
 * is not an allowed origin, and it recomputes `SHA-256(verifier)` and compares
 * it against the `challenge` sent here. A drift in either - a relative `cb`, a
 * differently-encoded digest - fails at runtime in a browser and nowhere else,
 * so it is pinned here against the server's own construction.
 */
const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
const config = resolveConfig({
  publishableKey: `pk_test_${PROJECT_ID}_abcdefghijklmnopqrstuvwxyz012345`,
  apiUrl: 'https://auth.authowl.test',
});

const startUrl = (href: string | null) => new URL(href!);

beforeEach(() => {
  document.cookie
    .split(';')
    .map((entry) => entry.split('=')[0]?.trim())
    .filter(Boolean)
    .forEach((name) => {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
    });
  window.history.replaceState(null, '', '/sign-in');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isBrowserRuntime', () => {
  it('is true in a browser with WebCrypto', () => {
    expect(isBrowserRuntime()).toBe(true);
  });
});

describe('challengeFor', () => {
  it('is the unpadded base64url of SHA-256, which is what the server recomputes', async () => {
    // The vector is the SERVER's own output, so this pins agreement across the
    // two repos rather than agreement with itself:
    //   createHash('sha256').update('authowl').digest('base64url')
    // (lib/auth/session-handoff/flow.ts, sessionHandoffVerifierDigest). If the
    // two ever diverge, no browser can complete a handoff and nothing else here
    // would notice.
    expect(await challengeFor('authowl')).toBe('zibvKzmWdoZiWN04zb2Kiu1Q5mIwSxZHR8bsh34hMfU');
  });

  it('never emits padding or base64 characters the server would decode differently', async () => {
    for (const input of ['a', 'ab', 'abc', 'x'.repeat(64)]) {
      expect(await challengeFor(input)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('beginCrossSiteSignIn', () => {
  it('builds a start URL the server will accept', async () => {
    const url = startUrl(await beginCrossSiteSignIn(
      config,
      { kind: 'social', provider: 'google', callbackURL: '/welcome', errorCallbackURL: '/sign-in?failed=1' },
    ));

    expect(url.origin + url.pathname)
      .toBe(`https://auth.authowl.test/api/projects/${PROJECT_ID}/auth/session/start`);
    expect(url.searchParams.get('kind')).toBe('social');
    expect(url.searchParams.get('provider')).toBe('google');
    // The publishable key travels in the query because the browser NAVIGATES
    // here and a navigation cannot set a header.
    expect(url.searchParams.get('pk')).toBe(config.publishableKey);
    // Absolute: the server checks the destination's ORIGIN against the
    // project's allow-list and refuses anything relative.
    expect(url.searchParams.get('cb')).toBe('https://app.tenant.test/welcome');
    expect(url.searchParams.get('err')).toBe('https://app.tenant.test/sign-in?failed=1');
    expect(url.searchParams.get('new')).toBeNull();
  });

  it('defaults the destination to the page that started the flow', async () => {
    const url = startUrl(await beginCrossSiteSignIn(config, { kind: 'social', provider: 'github' }));

    expect(url.searchParams.get('cb')).toBe('https://app.tenant.test/sign-in');
  });

  it('sends only the hash of the verifier, and keeps the verifier on this origin', async () => {
    const url = startUrl(await beginCrossSiteSignIn(config, { kind: 'social', provider: 'google' }));
    const verifier = /authowl_handoff_verifier=([^;]+)/.exec(document.cookie)?.[1];

    expect(verifier).toBeTruthy();
    expect(url.searchParams.get('challenge')).toBe(await challengeFor(verifier!));
    // The verifier itself must never reach the auth host, or it stops being a
    // second factor on the code.
    expect(url.toString()).not.toContain(verifier!);
  });

  it('forwards the provider options a navigation cannot put in a body', async () => {
    // Without these a caller asking for extra scopes would be pushed back onto
    // the broken transport, i.e. get no fix at all.
    const url = startUrl(await beginCrossSiteSignIn(config, {
      kind: 'social',
      provider: 'github',
      scopes: ['repo', 'read:org'],
      loginHint: 'user@acme.test',
      requestSignUp: false,
    }));

    expect(url.searchParams.get('scopes')).toBe('repo,read:org');
    expect(url.searchParams.get('loginHint')).toBe('user@acme.test');
    expect(url.searchParams.get('requestSignUp')).toBe('0');
  });

  it('declines a destination on another origin, which could not read the verifier', async () => {
    // A marketing site sending people to the app. The verifier cookie is
    // host-only on the page that started the flow, so the destination page could
    // not present it - the exchange would be refused and the code burned, every
    // time. Returning null hands the call back to the legacy transport instead.
    const url = await beginCrossSiteSignIn(config, {
      kind: 'social',
      provider: 'google',
      callbackURL: 'https://other.tenant.test/done',
    });

    expect(url).toBeNull();
    expect(document.cookie).not.toContain('authowl_handoff_verifier=');
  });

  it('passes the SSO connection selectors through, and drops the empty ones', async () => {
    const url = startUrl(await beginCrossSiteSignIn(
      config,
      { kind: 'sso', email: 'user@acme.test', domain: '', callbackURL: 'https://app.tenant.test/app' },
    ));

    expect(url.searchParams.get('kind')).toBe('sso');
    expect(url.searchParams.get('email')).toBe('user@acme.test');
    expect(url.searchParams.has('domain')).toBe(false);
    expect(url.searchParams.has('provider')).toBe(false);
  });
});

describe('takeHandoffCode', () => {
  it('reads the code and takes it out of the address bar', async () => {
    window.history.replaceState(null, '', '/welcome?ref=x#authowl_code=abc123');

    expect(takeHandoffCode()).toBe('abc123');
    // Gone before anything is awaited, so a back-navigation cannot re-present a
    // spent code.
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?ref=x');
  });

  it('leaves an unrelated fragment alone', () => {
    window.history.replaceState(null, '', '/welcome#section-2');

    expect(takeHandoffCode()).toBeNull();
    expect(window.location.hash).toBe('#section-2');
  });

  it('keeps the rest of a fragment it had to edit', () => {
    window.history.replaceState(null, '', '/w#a=1&authowl_code=abc&b=2');

    expect(takeHandoffCode()).toBe('abc');
    expect(window.location.hash).toBe('#a=1&b=2');
  });

  it('is a no-op on an ordinary page load', () => {
    expect(takeHandoffCode()).toBeNull();
  });
});

describe('completeCrossSiteSignIn', () => {
  /** Stands in for the shared client, whose deadline and error mapping this now rides on. */
  function httpStub(result: { error: unknown } = { error: null }) {
    return { request: vi.fn().mockResolvedValue({ data: { status: true }, ...result }) };
  }

  /** A fresh store per test: it is a module-level singleton per project. */
  let handoffProjects = 0;
  const freshTokens = () => sessionTokenStore(`handoff-${(handoffProjects += 1)}`);

  it('does nothing when the page load carries no code', async () => {
    const http = httpStub();

    expect(await completeCrossSiteSignIn(http as never, freshTokens())).toBe(false);
    expect(http.request).not.toHaveBeenCalled();
  });

  it('exchanges the code with the verifier, crediting cookies to this origin', async () => {
    await beginCrossSiteSignIn(config, { kind: 'social', provider: 'google' });
    const verifier = /authowl_handoff_verifier=([^;]+)/.exec(document.cookie)?.[1];
    window.history.replaceState(null, '', '/welcome#authowl_code=code-1');
    const http = httpStub();

    expect(await completeCrossSiteSignIn(http as never, freshTokens())).toBe(true);

    const [path, options] = http.request.mock.calls[0]!;
    expect(path).toBe('/session/exchange');
    expect(options).toMatchObject({ method: 'POST', body: { code: 'code-1', verifier } });
  });

  it('begins the session before the exchange, so a stale verdict cannot burn the code', async () => {
    await beginCrossSiteSignIn(config, { kind: 'social', provider: 'google' });
    window.history.replaceState(null, '', '/welcome#authowl_code=code-1');
    const tokens = freshTokens();
    // Measured as cookie-capable on Safari 18.4; the user has since taken 18.5,
    // where `Partitioned` is ignored and the session cookie is dropped.
    tokens.beginRead().recordCookieVerdict(true);
    expect(tokens.wantsToken()).toBe(false);

    await completeCrossSiteSignIn(httpStub() as never, tokens);

    // The code is single-use and the exchange response is the ONLY one carrying
    // this session. Arriving here unable to accept a token means burning the
    // code with neither cookie nor token, recoverable only by redoing the whole
    // OAuth round trip.
    expect(tokens.wantsToken()).toBe(true);
    expect(tokens.needsProbe()).toBe(true);
  });

  it('burns the verifier even when the exchange fails', async () => {
    await beginCrossSiteSignIn(config, { kind: 'social', provider: 'google' });
    window.history.replaceState(null, '', '/w#authowl_code=code-1');

    expect(await completeCrossSiteSignIn(httpStub({ error: { code: 'INVALID_SESSION_CODE' } }) as never, freshTokens()))
      .toBe(false);
    // A verifier left behind would be offered against the NEXT flow's code.
    expect(document.cookie).not.toContain('authowl_handoff_verifier=');
  });

  it('reports a transport failure as "not signed in"', async () => {
    window.history.replaceState(null, '', '/w#authowl_code=code-1');

    // This runs on page load, before any app code, so it must never reject: the
    // shared client turns a network failure or a timeout into `{ error }`.
    await expect(completeCrossSiteSignIn(httpStub({ error: { code: 'NETWORK' } }) as never, freshTokens()))
      .resolves.toBe(false);
  });

  it('refuses to exchange when the verifier cookie is missing', async () => {
    // The code alone is a bearer credential for a live session. An attacker who
    // starts their own flow, completes consent as themselves and reads the code
    // off the redirect could hand it to a victim; exchanging without a verifier
    // would sign the victim into the ATTACKER's account. Every flow this client
    // starts registers a challenge, so a missing verifier is a lost cookie or a
    // code from somewhere else - never a legitimate flow.
    window.history.replaceState(null, '', '/w#authowl_code=code-1');
    const http = httpStub();

    expect(await completeCrossSiteSignIn(http as never, freshTokens())).toBe(false);
    expect(http.request).not.toHaveBeenCalled();
  });
});
