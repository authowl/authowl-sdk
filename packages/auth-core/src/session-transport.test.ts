/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://app.tenant.test/" }
 *
 * EVERY door, against the server's actual rule.
 *
 * This SDK has now shipped "fixed one request path and missed the parallel one"
 * three times, and the failure is silent by construction: a bearer the server
 * does not honour is ANONYMOUS, not refused, so a door that forgets the
 * declaration header returns 200 and signs the user out with nothing in any
 * console and nothing in any log.
 *
 * So the fake engine below is not a stub that records headers - it is all four
 * of the server's rules, transcribed from `lib/auth/bearer-session-token.ts`:
 *
 *  - SESSION INGRESS (`presentedSessionToken`): a token counts only when
 *    `x-authowl-session-transport: bearer` rides with it.
 *  - SESSION EGRESS (`applyBearerTransportEgress`): a response carries
 *    `set-auth-token` when it sets a live session cookie AND the request declared
 *    the transport AND the request is a cross-site fetch.
 *  - CHALLENGE INGRESS (`presentedChallengeCookies`): `x-authowl-challenge` is
 *    read only under the SAME declaration - there is no second opt-in - and only
 *    for this project's own full cookie names.
 *  - CHALLENGE EGRESS (`challengeCookiesFrom`): a response carries
 *    `set-auth-challenge` naming only the cookies IT wrote, so most responses
 *    carry no such header at all.
 *
 * The challenge is why a 2FA user can sign in here at all. A credential sign-in
 * by one DELETES the session it just minted and issues a signed `two_factor`
 * ticket instead, so at that moment there is no session for the token transport
 * to carry, and on these browsers the ticket cookie is dropped exactly like the
 * session cookie was.
 *
 * The egress half is transcribed as the RULE and not as a list of minting paths,
 * which is the whole point. An earlier version of this file hardcoded three
 * paths, so every other door the server mints on - email OTP, phone OTP, email
 * verification, the 2FA verifies, passkey, social ID-token, the cross-site
 * exchange - could forget the transport entirely and still pass here. A door
 * that forgets it now fails as a signed-out user, which is exactly how it would
 * fail in production.
 *
 * And the browser: Safari inside the no-CHIPS window, which keeps no cross-site
 * cookie whatsoever. There is no cookie jar here on purpose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import { createAuthOwlClient } from './client';
import type { AuthOwlClient } from './client';
import { createAuthActionClient } from './native-client';
import {
  sessionTokenStorageKey,
  SESSION_TOKEN_HEADER,
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
  sessionTokenStore,
} from './session-token';
import {
  challengeStorageKey,
  CHALLENGE_HEADER,
  CHALLENGE_REQUEST_HEADER,
} from './session-challenge';

const API = 'https://auth.authowl.test';
const SESSION_TOKEN = 'session-value.signature';
/**
 * A signed ticket as the engine writes one: base64url with a `.`, percent-encoded.
 * The same bytes have to come back as a cookie value, so any decode or re-encode
 * on the way through is a correct code answered `INVALID_TWO_FACTOR_COOKIE`.
 */
const TICKET = 'eyJpZCI6MX0%3D.dGlja2V0';
const DONT_REMEMBER = 'dHJ1ZQ%3D%3D.c2ln';

/**
 * The FULL on-the-wire cookie names, derived here exactly as the server derives
 * them (`projectCookiePrefix` in `lib/auth/session-handoff/cookies.ts`): the
 * project id lower-cased with its dashes stripped, and no `__Secure-` because
 * these keys are test-environment ones.
 *
 * The fake owning this derivation is what proves the SDK treats the names as
 * OPAQUE. The SDK cannot hold a copy of it: it does not know whether the server
 * is running in production, and which cookies may ride is a server-owned
 * decision it must not second-guess. A test that let the SDK name these would be
 * asserting a rule the SDK does not get to hold.
 */
const cookiePrefix = (projectId: string) =>
  `p_${projectId.toLowerCase().replace(/-/g, '')}`;
const ticketCookie = (projectId: string) => `${cookiePrefix(projectId)}.two_factor`;
const rememberCookie = (projectId: string) => `${cookiePrefix(projectId)}.dont_remember`;
const USER = {
  id: 'user',
  email: 'someone@example.test',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let projectCounter = 0;
/** A fresh project per test: the token store is a module-level singleton per project. */
function freshProject(): string {
  projectCounter += 1;
  return `11111111-1111-1111-1111-${String(projectCounter).padStart(12, '0')}`;
}

type Call = {
  url: URL;
  method: string;
  headers: Headers;
  /** The challenge cookies the SERVER's ingress rule agreed to accept from this request. */
  challenge: Map<string, string>;
};

const BEARER_SCHEME = /^bearer\s+/i;
const MAX_CHALLENGE_HEADER_LENGTH = 2048;
/** RFC 6265 cookie-octet, as the server's ingress applies it to a presented value. */
const COOKIE_OCTET = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

/**
 * The header reads the server's rules are built from, written ONCE.
 *
 * The fake engine below decides with these and the assertions check with them,
 * because a file arguing that this rule must live in one place cannot afford to
 * state it twice and have the two drift.
 */
const declaresOn = (headers: Headers): boolean =>
  headers.get(SESSION_TRANSPORT_HEADER)?.toLowerCase() === SESSION_TRANSPORT_BEARER;
const bearerOn = (headers: Headers): string | null => {
  const value = headers.get('authorization');
  return value && BEARER_SCHEME.test(value) ? value.replace(BEARER_SCHEME, '').trim() : null;
};

/**
 * CHALLENGE INGRESS, transcribed.
 *
 * The declaration gates it, exactly as it gates the bearer, and there is no
 * second opt-in - so a request carrying a perfectly good ticket without it is
 * ANONYMOUS rather than refused, which is the silent failure this whole file
 * exists to catch. Duplicates collapse LAST-WINS (the browser's own rule for its
 * `Cookie` header), the collapsed winner is then judged, and only this project's
 * own full names are accepted: matching a logical suffix instead would let
 * another project's ticket be planted here.
 */
function challengeOn(headers: Headers, projectId: string): Map<string, string> {
  const accepted = new Map<string, string>();
  if (!declaresOn(headers)) return accepted;
  const header = headers.get(CHALLENGE_REQUEST_HEADER);
  // Refused WHOLE above the ceiling, never partially applied.
  if (!header || header.length > MAX_CHALLENGE_HEADER_LENGTH) return accepted;

  const presented = new Map<string, string>();
  for (const entry of header.split(';')) {
    const pair = entry.trim();
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    presented.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  for (const name of [ticketCookie(projectId), rememberCookie(projectId)]) {
    const value = presented.get(name);
    // An empty value is a signal FROM the server, never an instruction to it:
    // honouring `<name>=` here would let script erase a cookie the jar holds.
    if (value !== undefined && COOKIE_OCTET.test(value)) accepted.set(name, value);
  }
  return accepted;
}

type EngineResponse = {
  status: number;
  payload: unknown;
  /**
   * Whether this response sets a LIVE session cookie - the only thing egress
   * actually looks at. Declared per endpoint, so adding a minting endpoint here
   * is a statement about the server rather than an entry in a path list.
   */
  setsSession?: boolean;
  /**
   * The challenge cookies THIS response writes, an empty value meaning deletion.
   *
   * ABSENT means the response writes no challenge cookie and therefore carries no
   * `set-auth-challenge` header AT ALL - which is the overwhelmingly common case
   * and the one an SDK gets wrong: `/two-factor/send-otp` reads the ticket and
   * writes nothing, and an ordinary `get-session` writes only the session cache.
   */
  challenge?: [string, string][];
};

type Engine = {
  fetch: typeof fetch;
  calls: Call[];
  /** Requests that presented a session the SERVER agreed to honour. */
  authenticated: Call[];
};

/**
 * Safari inside the no-CHIPS window: no cookie jar at all.
 *
 * `twoFactorRequired` makes the credential sign-in answer with a 2FA challenge.
 */
const safariEngine = (
  projectId: string,
  options: { twoFactorRequired?: boolean } = {},
): Engine => fakeEngine(projectId, options);

/**
 * The same engine on a browser that KEEPS our cross-site cookie - Chrome,
 * Firefox, Safari outside the broken window.
 *
 * The jar models the SESSION cookie and nothing else, which is what the tests
 * using it are about. Note what does NOT change: the server still hands back a
 * token, because a request that declares the transport gets one and no server
 * can tell from a request whether the cookie it is also setting will survive.
 * That token arriving on a browser that did not need it is the entire subject.
 */
const chromeEngine = (projectId: string): Engine =>
  fakeEngine(projectId, { keepsCookies: true });

function fakeEngine(
  projectId: string,
  {
    twoFactorRequired = false,
    keepsCookies = false,
  }: { twoFactorRequired?: boolean; keepsCookies?: boolean } = {},
): Engine {
  const calls: Call[] = [];
  const authenticated: Call[] = [];
  /** Whether this browser's jar is currently holding a live session cookie. */
  let jarred = false;

  const engineFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    const declared = declaresOn(headers);
    const challenge = challengeOn(headers, projectId);
    const call = { url, method, headers, challenge };
    calls.push(call);

    // INGRESS. Not `bearerOn(headers) !== null`.
    // The jar resolves a session on its own, with no header of any kind - which
    // is what makes the detached probe a measurement rather than a guess.
    const session = jarred || (declared && bearerOn(headers) === SESSION_TOKEN);
    if (session) authenticated.push(call);
    if (url.pathname.endsWith('/sign-out')) jarred = false;

    const body = responseFor({
      url,
      projectId,
      session,
      challenge,
      sent: requestBody(init),
      twoFactorRequired,
    });
    // EGRESS, as the rule and not as a path list. `Sec-Fetch-Site` is stamped by
    // the browser and cannot be set from script, so the origin comparison stands
    // in for it: the SDK talks to the auth host from a tenant page.
    const crossSite = url.origin !== window.location.origin;
    const exposes = declared && crossSite;
    const mints = body.setsSession === true && exposes;
    if (body.setsSession === true && keepsCookies) jarred = true;

    const sending = new Headers();
    if (mints) sending.set(SESSION_TOKEN_HEADER, SESSION_TOKEN);
    // Both cargoes ride the same gate, and a response that wrote no challenge
    // cookie says NOTHING rather than saying "empty".
    if (body.challenge && exposes) {
      sending.set(
        CHALLENGE_HEADER,
        body.challenge.map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    return Response.json(body.payload, { status: body.status, headers: sending });
  }) as typeof fetch;

  return { fetch: engineFetch, calls, authenticated };
}

/** The JSON body a door posted, which is where `rememberMe` reaches the engine. */
function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(init.body);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

type EngineRequest = {
  url: URL;
  projectId: string;
  session: boolean;
  challenge: Map<string, string>;
  sent: Record<string, unknown>;
  twoFactorRequired: boolean;
};

function responseFor({
  url,
  projectId,
  session,
  challenge,
  sent,
  twoFactorRequired,
}: EngineRequest): EngineResponse {
  const path = url.pathname;
  // This fake models an older self-hosted server. The new SDK must preserve the
  // legacy measured transport only when the additive capability route is truly
  // absent, never for an auth or network failure.
  if (path.endsWith('/session/cookie-capability')) {
    return { status: 404, payload: { code: 'NOT_FOUND' } };
  }
  /** An endpoint that answers 401 to anyone the INGRESS rule did not authenticate. */
  const guarded = (payload: unknown): EngineResponse =>
    session
      ? { status: 200, payload }
      : { status: 401, payload: { error: 'unauthorized' } };

  /**
   * An endpoint the engine resolves from the 2FA TICKET rather than a session.
   *
   * Its failure is the real one: `INVALID_TWO_FACTOR_COOKIE`, which is what a
   * correct code gets answered with when the ticket never arrived.
   */
  const ticketed = (result: Omit<EngineResponse, 'status'>): EngineResponse =>
    challenge.get(ticketCookie(projectId)) === TICKET
      ? { status: 200, ...result }
      : {
        status: 401,
        payload: {
          code: 'INVALID_TWO_FACTOR_COOKIE',
          message: 'Invalid two factor cookie',
        },
      };

  if (path.endsWith('/get-session')) {
    return {
      status: 200,
      payload: session
        ? {
          session: { id: 'sess', userId: 'user', expiresAt: '2027-01-01T00:00:00.000Z' },
          user: USER,
        }
        : null,
    };
  }
  if (path === `/api/projects/${projectId}/consent`) {
    return guarded({ required: true, needsConsent: false, version: 3, ok: true });
  }
  if (path.endsWith('/auth/token')) {
    return guarded({ token: 'header.payload.signature' });
  }
  if (path.endsWith('/user/metadata')) {
    return guarded({ public_metadata: {}, unsafe_metadata: {}, metadata_version: 1 });
  }
  // Every endpoint below sets a live session cookie, which is the ONLY thing
  // that makes a response carry a token back.
  if (path.endsWith('/sign-in/email') || path.endsWith('/sign-in/username')) {
    if (!twoFactorRequired) {
      return {
        status: 200,
        payload: { redirect: false, user: USER, token: 'ignored-by-the-sdk' },
        setsSession: true,
      };
    }
    // A challenged credential sign-in mints NOTHING. The engine deletes the
    // session it just created and issues the ticket in its place, so
    // `setsSession` is deliberately absent here: there is no session for the
    // token transport to carry, and everything that follows rides the challenge.
    const issued: [string, string][] = [[ticketCookie(projectId), TICKET]];
    // `dont_remember` is written only when the user DECLINED. It is the engine's
    // marker for a non-persistent session and is simply absent otherwise - which
    // is what makes a header naming one cookie and not the other the ordinary
    // case rather than an edge one.
    if (sent.rememberMe === false) issued.push([rememberCookie(projectId), DONT_REMEMBER]);
    return { status: 200, payload: { twoFactorRedirect: true }, challenge: issued };
  }
  if (path.endsWith('/sign-up/email')) {
    return {
      status: 200,
      payload: { redirect: false, user: USER, token: 'ignored-by-the-sdk' },
      setsSession: true,
    };
  }
  if (path.endsWith('/sign-in/email-otp')) {
    return { status: 200, payload: { user: USER }, setsSession: true };
  }
  if (path.endsWith('/sign-in/social')) {
    return { status: 200, payload: { redirect: false, user: USER }, setsSession: true };
  }
  if (path.endsWith('/email-otp/verify-email')) {
    return { status: 200, payload: { status: true, user: USER }, setsSession: true };
  }
  if (path.endsWith('/phone-otp/verify')) {
    return {
      status: 200,
      payload: {
        status: true,
        sessionCreated: true,
        user: { id: 'user', phoneNumber: '+201000000000', phoneNumberVerified: true },
      },
      setsSession: true,
    };
  }
  if (path.endsWith('/two-factor/send-otp')) {
    // NO `challenge` key: this endpoint READS the ticket to find out who is
    // signing in and writes no cookie at all, so its response carries no
    // `set-auth-challenge`. It is the email-OTP recovery factor, and it is the
    // response an SDK that treats the header as authoritative destroys the live
    // ticket on.
    return ticketed({ payload: { status: true } });
  }
  if (path.includes('/two-factor/verify-')) {
    return ticketed({
      payload: { status: true },
      setsSession: true,
      // The spent ticket is destroyed and `dont_remember` is NOT mentioned: the
      // engine reads it for the life of the SESSION to decide expiry refresh, so
      // it deliberately outlives the challenge it arrived with.
      challenge: [[ticketCookie(projectId), '']],
    });
  }
  if (path.endsWith('/passkey/generate-authenticate-options')) {
    return { status: 200, payload: { challenge: 'Y2hhbGxlbmdl' } };
  }
  if (path.endsWith('/passkey/verify-authentication')) {
    return {
      status: 200,
      payload: {
        session: { id: 'sess', userId: 'user', expiresAt: '2027-01-01T00:00:00.000Z' },
        user: USER,
      },
      setsSession: true,
    };
  }
  if (path.endsWith('/session/exchange')) {
    return { status: 200, payload: { ok: true }, setsSession: true };
  }
  if (path.endsWith('/sign-out')) return { status: 200, payload: { success: true } };
  if (path.endsWith('/list-sessions')) return { status: 200, payload: [] };
  return { status: 200, payload: { ok: true } };
}

function clientFor(projectId: string, engine: Engine): AuthOwlClient {
  return createAuthOwlClient(configFor(projectId, engine));
}

function configFor(projectId: string, engine: Engine) {
  return resolveConfig({
    publishableKey: `pk_test_${projectId}_abcdefghijklmnopqrstuvwxyz012345`,
    apiUrl: API,
    fetch: engine.fetch,
  });
}

/** Captured before any test can wrap it. See `storageWrites`. */
const realSetItem = Storage.prototype.setItem;

const declares = (call: Call) => declaresOn(call.headers);
const presentsToken = (call: Call) => bearerOn(call.headers) !== null;
const presentsChallenge = (call: Call) => call.headers.has(CHALLENGE_REQUEST_HEADER);
/**
 * How a call is addressed, written once for both finders below. Two copies of
 * this would let one of them be taught about a query string or a method while
 * the other silently kept matching the wrong call - and these feed assertions
 * that pass just as happily against the wrong `/get-session`.
 */
const wentTo = (path: string) => (entry: Call) => entry.url.pathname.includes(path);
const callTo = (engine: Engine, path: string) => engine.calls.find(wentTo(path));
const lastCallTo = (engine: Engine, path: string) => engine.calls.findLast(wentTo(path));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // A spy on `Storage.prototype` left installed is not merely untidy here: the
  // next `vi.spyOn` of the same method hands back the SAME mock, so a helper
  // that wraps "the original" ends up wrapping itself, and the recursion is
  // swallowed whole by the try/catch in `web-storage.ts` that exists for private
  // browsing. Every write after it silently does nothing.
  vi.restoreAllMocks();
});

type Door = { name: string; path: string; run: (client: AuthOwlClient) => Promise<unknown> };

/**
 * The doors that BEGIN a session, and therefore have to re-arm the browser
 * measurement before they dispatch.
 *
 * The 2FA verifies are deliberately absent: they CONTINUE a session begun at the
 * credential sign-in, which already declared the user's "remember me" answer.
 * They are covered end to end below instead.
 */
const mintingDoors: Door[] = [
  {
    name: 'credential sign-in',
    path: '/sign-in/email',
    run: (client) => client.signIn.email({ email: 'a@b.test', password: 'pw' }),
  },
  {
    name: 'username sign-in',
    path: '/sign-in/username',
    run: (client) => client.signIn.username({ username: 'a', password: 'pw' }),
  },
  {
    name: 'email-OTP sign-in',
    path: '/sign-in/email-otp',
    run: (client) => client.signIn.emailOtp({ email: 'a@b.test', otp: '123456' }),
  },
  {
    name: 'social ID-token sign-in',
    path: '/sign-in/social',
    run: (client) =>
      client.signIn.social({ provider: 'google', idToken: { token: 'id-token' } }),
  },
  {
    name: 'sign-up',
    path: '/sign-up/email',
    run: (client) => client.signUp.email({ email: 'a@b.test', password: 'pw', name: 'A' }),
  },
  {
    name: 'email verification by OTP',
    path: '/email-otp/verify-email',
    run: (client) => client.emailOtp.verifyEmail({ email: 'a@b.test', otp: '123456' }),
  },
  {
    name: 'phone-OTP verification',
    path: '/phone-otp/verify',
    run: (client) => client.phoneOtp.verify({ phoneNumber: '+201000000000', code: '424242' }),
  },
];

/**
 * Every request path in this SDK that can carry a session, exercised through the
 * PUBLIC method a tenant actually calls.
 *
 * Written as a list rather than as one test per door so that a door added
 * without the transport has somewhere obvious to be missing from - and so the
 * invariants below are stated once and hold over all of them.
 */
const doors: Door[] = [
  ...mintingDoors,
  {
    name: 'two-factor TOTP verify',
    path: '/two-factor/verify-totp',
    run: (client) => client.twoFactor.verifyTotp({ code: '123456' }),
  },
  {
    name: 'two-factor backup-code verify',
    path: '/two-factor/verify-backup-code',
    run: (client) => client.twoFactor.verifyBackupCode({ code: 'backup-code' }),
  },
  {
    name: 'two-factor OTP verify',
    path: '/two-factor/verify-otp',
    run: (client) => client.twoFactor.verifyOtp({ code: '123456' }),
  },
  { name: 'session read', path: '/get-session', run: (client) => client.getSession() },
  {
    name: 'JWT issuer (http.ts door)',
    path: '/auth/token',
    run: (client) => client.getToken(),
  },
  {
    name: 'consent status (http.ts door)',
    path: '/consent',
    run: (client) => client.getConsentStatus(),
  },
  {
    name: 'consent acceptance (http.ts door)',
    path: '/consent',
    run: (client) => client.acceptConsent(3),
  },
  {
    name: 'user metadata',
    path: '/user/metadata',
    run: (client) => client.account.getMetadata(),
  },
  { name: 'sign-out', path: '/sign-out', run: (client) => client.signOut() },
  {
    name: 'account sessions',
    path: '/list-sessions',
    run: (client) => client.account.listSessions(),
  },
];

/**
 * The doors differ in how they report "not signed in" - some resolve an error,
 * some throw. What is on the wire is the subject here, so the outcome is not.
 */
const attempt = async (client: AuthOwlClient, run: (client: AuthOwlClient) => Promise<unknown>) => {
  await run(client).catch(() => undefined);
};

describe('the session rides every door', () => {
  it.each(doors)('$name declares the transport', async ({ path, run }) => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    await attempt(clientFor(projectId, engine), run);

    const call = callTo(engine, path);
    expect(call, `no request reached ${path}`).toBeDefined();
    expect(declares(call!)).toBe(true);
  });

  it.each(doors)('$name never presents a token without the declaration', async ({ run }) => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    // Hand the store a token first, so every request has one to get wrong.
    sessionTokenStore(projectId).observe(new Headers({ [SESSION_TOKEN_HEADER]: SESSION_TOKEN }));

    await attempt(clientFor(projectId, engine), run);

    // The silent failure this file exists for: a bearer the server does not
    // honour is anonymous, so an undeclared one is a signed-out user with a 200.
    const undeclared = engine.calls.filter((call) => presentsToken(call) && !declares(call));
    expect(undeclared.map((call) => call.url.pathname)).toEqual([]);
  });

  it.each(doors)('$name never presents a challenge without the declaration', async ({ run }) => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    // Hand the store a challenge first, so every request has one to get wrong.
    sessionTokenStore(projectId).observe(new Headers({
      [CHALLENGE_HEADER]: `${ticketCookie(projectId)}=${TICKET}`,
    }));

    await attempt(clientFor(projectId, engine), run);

    // Same silent failure as the bearer, one cargo over: the server reads
    // `x-authowl-challenge` only under the declaration, so an undeclared ticket
    // is not refused, it is invisible - and the user is told their correct code
    // is wrong.
    const undeclared = engine.calls.filter((call) => presentsChallenge(call) && !declares(call));
    expect(undeclared.map((call) => call.url.pathname)).toEqual([]);
  });

  it.each(mintingDoors)(
    '$name still mints on a browser measured before it changed',
    async ({ path, run }) => {
      const projectId = freshProject();
      const engine = safariEngine(projectId);
      // Safari 18.4, where `Partitioned` worked: measured cookie-capable, token
      // dropped, and the SDK stopped asking. The user has since taken 18.5.
      sessionTokenStore(projectId).beginRead().recordCookieVerdict(true);

      await attempt(clientFor(projectId, engine), run);

      // Without a re-arm at this door the request never declares, so the server
      // hands back no token, so every request after this 200 is anonymous - and
      // no measurement is ever taken again, so it stays that way.
      expect(declares(callTo(engine, path)!)).toBe(true);
      expect(sessionTokenStore(projectId).hasToken()).toBe(true);
    },
  );
});

describe('a Safari session survives, end to end', () => {
  it('signs in, and stays signed in on the doors that skip the auth catch-all', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    const client = clientFor(projectId, engine);

    // No cookie comes back - this browser keeps none. The session exists only if
    // the sign-in declared the transport and the token was captured.
    const signedIn = await client.signIn.email({ email: 'a@b.test', password: 'pw' });
    expect(signedIn.error).toBeNull();

    const session = await client.getSession();
    expect(session.data?.user.id).toBe('user');

    // The two doors `http.ts` owns, and the reason this rework exists: they are
    // STATIC route segments on the server, so they never pass through the auth
    // catch-all that translates the bearer for everything else. They were the
    // paths the first version left broken.
    await expect(client.getToken()).resolves.toBe('header.payload.signature');
    await expect(client.getConsentStatus()).resolves.toMatchObject({ required: true });

    expect(engine.authenticated.map((call) => call.url.pathname)).toEqual(
      expect.arrayContaining([
        `/api/projects/${projectId}/auth/get-session`,
        `/api/projects/${projectId}/auth/token`,
        `/api/projects/${projectId}/consent`,
      ]),
    );
  });

  it('signs a 2FA user in end to end, on a challenge with no session behind it', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId, { twoFactorRequired: true });
    const client = clientFor(projectId, engine);

    const challenged = await client.signIn.email({
      email: 'a@b.test',
      password: 'pw',
      rememberMe: false,
    });
    expect(challenged.data).toMatchObject({ twoFactorRedirect: true });
    // Nothing for the SESSION transport to hold: the engine deleted the session
    // it minted in order to issue the ticket. This is the whole reason a second
    // cargo exists, and asserting it here is what stops a later change quietly
    // making this flow pass on the bearer instead.
    expect(sessionTokenStore(projectId).hasToken()).toBe(false);
    expect(localStorage.getItem(challengeStorageKey(projectId))).toBeNull();

    const verified = await client.twoFactor.verifyTotp({ code: '123456' });
    expect(verified.error).toBeNull();

    // The verify rides the TICKET. Without it the engine resolves neither a
    // session nor a cookie and answers `INVALID_TWO_FACTOR_COOKIE` - a correct
    // code rejected, for every 2FA user on these browsers.
    const verify = callTo(engine, '/two-factor/verify-totp')!;
    expect(verify.challenge.get(ticketCookie(projectId))).toBe(TICKET);
    // Byte for byte: the value the server wrote is the value it got back. A
    // decode or re-encode anywhere in between fails the signature check and is
    // indistinguishable, to the user, from typing the wrong code.
    expect(verify.headers.get(CHALLENGE_REQUEST_HEADER))
      .toContain(`${ticketCookie(projectId)}=${TICKET}`);
    // The user's "remember me" answer travelled with it, and the verify must not
    // re-begin the session: doing so would default that answer back to true and
    // promote a session they asked not to have remembered.
    expect(verify.challenge.get(rememberCookie(projectId))).toBe(DONT_REMEMBER);
    // After the measurement, which the verify's own mint asked for: the token is
    // held in memory until this browser has PROVEN it drops our cookie.
    await vi.waitFor(() =>
      expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBe(SESSION_TOKEN),
    );
    expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
  });

  it('keeps dont_remember after the ticket it arrived with is spent', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId, { twoFactorRequired: true });
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw', rememberMe: false });
    await client.twoFactor.verifyTotp({ code: '123456' });
    await client.getSession();

    const read = lastCallTo(engine, '/get-session')!;
    // SENT ON EVERY DECLARED REQUEST, not only on the verify. `dont_remember`
    // outlives the challenge it arrived with - `get-session` reads it for the
    // life of the session to decide whether to refresh expiry - so a store
    // presented only when answering a code leaves a "don't remember me" session
    // quietly resuming refresh.
    expect(read.challenge.get(rememberCookie(projectId))).toBe(DONT_REMEMBER);
    // And the spent ticket is gone, because the verify's response said so with
    // an empty value while saying nothing at all about `dont_remember`. Applying
    // that header as the full set would have taken both.
    expect(read.challenge.has(ticketCookie(projectId))).toBe(false);
  });

  it('keeps the email-OTP recovery factor alive across a response that writes no cookie', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId, { twoFactorRequired: true });
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw' });
    // `/two-factor/send-otp` READS the ticket and writes no cookie, so its
    // response carries no `set-auth-challenge` at all - like most responses on
    // this transport. An SDK that read that silence as the authoritative set
    // would destroy the live ticket right here, and the recovery factor would
    // die with nothing shown anywhere.
    const sent = await client.twoFactor.sendOtp();
    expect(sent.error).toBeNull();

    const verified = await client.twoFactor.verifyOtp({ code: '123456' });
    expect(verified.error).toBeNull();
  });

  it('drops a ticket the engine has rejected instead of presenting it forever', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId, { twoFactorRequired: true });
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw', rememberMe: false });
    // A ticket the engine will not accept - it expired, or was already spent by
    // another tab. The SDK cannot tell those apart and does not need to: both
    // mean this challenge is over and the user starts at the first factor.
    sessionTokenStore(projectId).observe(new Headers({
      [CHALLENGE_HEADER]: `${ticketCookie(projectId)}=stale.ticket`,
    }));

    const rejected = await client.twoFactor.verifyTotp({ code: '123456' });
    expect(rejected.error?.code).toBe('INVALID_TWO_FACTOR_COOKIE');

    await client.getSession();
    const read = lastCallTo(engine, '/get-session')!;
    // The whole store goes, `dont_remember` included: it described the sign-in
    // that just failed. Keeping a dead ticket would present it on every request
    // for the life of the tab.
    expect(presentsChallenge(read)).toBe(false);
    expect(sessionStorage.getItem(challengeStorageKey(projectId))).toBeNull();
  });

  it('treats a ticket presented without the declaration as anonymous, not refused', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId, { twoFactorRequired: true });

    // Straight at the engine, because the SDK will not produce this request -
    // and that is exactly why it is pinned. Every 2FA assertion above rests on
    // the fake enforcing the declaration; if it quietly did not, a door that
    // forgot the header would pass this whole file and fail in production as a
    // correct code rejected, with nothing in any console.
    const response = await engine.fetch(
      `${API}/api/projects/${projectId}/auth/two-factor/verify-totp`,
      {
        method: 'POST',
        headers: { [CHALLENGE_REQUEST_HEADER]: `${ticketCookie(projectId)}=${TICKET}` },
        body: JSON.stringify({ code: '123456' }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_TWO_FACTOR_COOKIE',
    });
  });

  it('redeems the cross-site handoff on the transport, before the cookie is known to fail', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    document.cookie = 'authowl_handoff_verifier=verifier-value; Path=/';
    window.history.replaceState(null, '', '/#authowl_code=handoff-code');

    const client = clientFor(projectId, engine);
    const session = await client.getSession();

    const exchange = callTo(engine, '/session/exchange');
    // The exchange code is SINGLE-USE and its response is the only one carrying
    // the session, so an SDK that waits to observe the cookie failing burns it
    // with neither cookie nor token and cannot recover short of redoing the whole
    // OAuth round trip.
    expect(exchange && declares(exchange)).toBe(true);
    expect(session.data?.user.id).toBe('user');
  });

  it('does not let a callback-free client own a later redirect return', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    window.history.replaceState(null, '', '/');

    // A provider created before navigation used to start and permanently cache
    // an empty lazy handoff. The destination provider then reused that settled
    // promise and never exchanged the code that had arrived in the meantime.
    await clientFor(projectId, engine).getSession();

    document.cookie = 'authowl_handoff_verifier=verifier-value; Path=/';
    window.history.replaceState(null, '', '/#authowl_code=handoff-code');
    const session = await clientFor(projectId, engine).getSession();

    expect(callTo(engine, '/session/exchange')).toBeDefined();
    expect(session.data?.user.id).toBe('user');
  });

  it('mints on the passkey ceremony door', async () => {
    // Reached through `createAuthActionClient` with the ceremony injected: jsdom
    // has no `navigator.credentials`, and the door under test is the wiring
    // around the ceremony rather than the ceremony itself.
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    sessionTokenStore(projectId).beginRead().recordCookieVerdict(true);
    const client = createAuthActionClient(
      configFor(projectId, engine),
      () => undefined,
      (http) => ({
        signIn: (_params, fetchOptions) =>
          http.request('/passkey/verify-authentication', {
            method: 'POST',
            body: { response: {} },
            fetchOptions,
          }) as never,
        add: (() => Promise.resolve({ data: null, error: null })) as never,
      }),
    );

    await client.signIn.passkey().catch(() => undefined);

    expect(declares(callTo(engine, '/passkey/verify-authentication')!)).toBe(true);
    expect(sessionTokenStore(projectId).hasToken()).toBe(true);
  });
});

describe('what deliberately stays off the transport', () => {
  it('sends no session on a request that carries no credentials at all', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    sessionTokenStore(projectId).observe(new Headers({ [SESSION_TOKEN_HEADER]: SESSION_TOKEN }));

    await clientFor(projectId, engine).waitlist.join({ email: 'a@b.test' });

    const call = callTo(engine, '/waitlist')!;
    // The token and the cookie are two spellings of one session. A request that
    // deliberately drops the cookie must drop the token with it, or the two
    // transports stop meaning the same thing.
    expect(presentsToken(call)).toBe(false);
    expect(declares(call)).toBe(false);
    // The challenge is a credential too, and a live ticket is worth stealing.
    // `credentials: 'omit'` means this request carries none of them.
    expect(presentsChallenge(call)).toBe(false);
  });

  it('leaves a caller-supplied Authorization alone, declaration included', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    sessionTokenStore(projectId).observe(new Headers({ [SESSION_TOKEN_HEADER]: SESSION_TOKEN }));

    await clientFor(projectId, engine).getSession();
    const first = engine.calls.length;

    await clientFor(projectId, engine).account.getMetadata({
      headers: { authorization: 'Bearer someone-elses-access-token' },
    });

    const call = engine.calls[first]!;
    expect(call.headers.get('authorization')).toBe('Bearer someone-elses-access-token');
    // Declaring here would tell the server to read THEIR OAuth access token as a
    // session, which is the confusion the paired-header contract exists to stop.
    expect(declares(call)).toBe(false);
  });

  it('measures the cookie on a probe that carries neither header', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw' });
    const unsubscribe = client.sessionStore.subscribe(() => {});

    // A read that leans on the token proves nothing about the cookie, so the
    // controller spends one request with the session deliberately detached. It
    // is fired AFTER the store has emitted, so waiting on `isPending` would race
    // it - the measurement is not session state and no longer sits in front of
    // the emit.
    await vi.waitFor(() => {
      const probe = engine.calls.find(
        (call) => call.url.searchParams.get('disableCookieCache') === 'true' && !presentsToken(call),
      );
      expect(probe, 'no cookie probe was sent').toBeDefined();
      expect(declares(probe!)).toBe(false);
    });
    unsubscribe();
  });
});

/**
 * The other half of the trade, on the browsers that are the overwhelming
 * majority of every tenant's traffic.
 *
 * A token is minted here too - it has to be, because which browsers need one
 * cannot be decided before the measurement - and the promise this transport
 * makes about it is exact: at most one token, in memory, briefly. It used to be
 * a promise the code did not keep. `setToken` persisted unconditionally, so
 * every cross-site sign-in wrote a script-readable session token to disk on
 * Chrome and Firefox and left it there until a session read happened to complete
 * the measurement - which, for an integration that never mounts a session store,
 * is never.
 */
describe('a browser that keeps our cookie is left holding nothing', () => {
  /**
   * Every write this document made to the token's slot, whatever ends up there.
   *
   * A final all-null assertion is the weakest possible form of this claim: it
   * passes just as happily against a token that was written and then cleaned up,
   * which is the defect. What matters is that the value never reaches disk AT
   * ALL, so the spy records the whole document's history and the assertion is
   * about that history.
   */
  function storageWrites(projectId: string): string[] {
    const written: string[] = [];
    const key = sessionTokenStorageKey(projectId);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      name: string,
      value: string,
    ) {
      if (name === key) written.push(value);
      // The pristine method, captured at module load rather than read off the
      // prototype here: reading it here would capture whatever spy a previous
      // test left behind, which is a wrapper around this same function.
      realSetItem.call(this, name, value);
    });
    return written;
  }

  it('never writes the token to storage across a full sign-in and read', async () => {
    const projectId = freshProject();
    const engine = chromeEngine(projectId);
    const written = storageWrites(projectId);
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw' });
    const unsubscribe = client.sessionStore.subscribe(() => {});
    await vi.waitFor(() =>
      expect(sessionTokenStore(projectId).wantsToken(), 'never measured').toBe(false),
    );
    await client.getSession();

    // The claim, at its strongest: not "storage is clean afterwards" but "the
    // credential never touched it". An attacker who reads storage at any moment
    // in this timeline - an XSS on any page of the app, a shared machine, a
    // browser extension - finds nothing to steal.
    expect(written).toEqual([]);
    expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
    expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
    // And the session works, on the cookie, with no token in memory either.
    expect(sessionTokenStore(projectId).hasToken()).toBe(false);
    expect(client.sessionStore.getSnapshot().data?.user.id).toBe('user');
    unsubscribe();
  });

  it('leaves nothing behind for an integration that never reads the session', async () => {
    const projectId = freshProject();
    const engine = chromeEngine(projectId);
    const written = storageWrites(projectId);

    // No `sessionStore.subscribe`, ever. Anything server-rendered, anything
    // headless, anything that drives the client from its own state: the
    // measurement used to be reachable only from a subscribed read, so these
    // integrations measured never and kept the token FOREVER - a permanent,
    // durable, script-readable session credential on a browser that had a
    // perfectly good HttpOnly cookie.
    await clientFor(projectId, engine).signIn.email({ email: 'a@b.test', password: 'pw' });

    await vi.waitFor(() =>
      expect(sessionTokenStore(projectId).wantsToken(), 'never measured').toBe(false),
    );
    expect(written).toEqual([]);
    expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
    expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
  });

  it('settles the verdict for a broken-cookie browser without a subscriber either', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);

    await clientFor(projectId, engine).signIn.email({ email: 'a@b.test', password: 'pw' });

    // The same door, the same absence of a subscriber, the opposite answer - and
    // this is the half the gate could have broken silently. Holding the token
    // back until a verdict that nothing ever asked for would leave a Safari user
    // signed out by every reload, which is the failure this whole transport was
    // built to remove.
    await vi.waitFor(() =>
      expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBe(SESSION_TOKEN),
    );
  });
});

/**
 * Placement is asserted through `vi.waitFor` throughout, and the wait is the
 * contract rather than flake insurance: nothing is written until the detached
 * probe answers, which is a round trip after the sign-in resolves. Asserting
 * straight after the `await` happens to pass against a fake engine that answers
 * in a microtask, and would be a lie about the order things happen in.
 */
describe('remember-me survives a transport that cannot carry dont_remember', () => {
  it('keeps the token out of localStorage when the user declined', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw', rememberMe: false });

    // Driven through the real client rather than the store: the engine mints a
    // persistent session regardless, so placement is the only thing that carries
    // the user's answer, and it has to survive the whole action path AND the
    // measurement to do it. `SessionStart.remember` in `session-token.ts` owns
    // why - including that `sessionStorage` is per TAB, so a declined session is
    // deliberately not shared with the others.
    await vi.waitFor(() =>
      expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBe(SESSION_TOKEN),
    );
    expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
  });

  it('persists across reload when the user did not decline', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw' });

    await vi.waitFor(() =>
      expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBe(SESSION_TOKEN),
    );
    expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
  });

  it('does not inherit the last session\'s answer at a door that has no rememberMe', async () => {
    const projectId = freshProject();
    const engine = safariEngine(projectId);
    const client = clientFor(projectId, engine);

    await client.signIn.email({ email: 'a@b.test', password: 'pw', rememberMe: false });
    await client.signOut();
    // Email OTP, phone OTP and the cross-site exchange carry no such option, so
    // the engine mints a persistent session for all three. Inheriting the last
    // answer is how a user who once declined stays signed out by every tab close
    // for good, with nothing to explain it.
    await client.signIn.emailOtp({ email: 'a@b.test', otp: '123456' });

    await vi.waitFor(() =>
      expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBe(SESSION_TOKEN),
    );
    expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
  });
});
