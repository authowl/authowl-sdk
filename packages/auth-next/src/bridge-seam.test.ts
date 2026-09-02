/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://app.example.com/" }
 *
 * The seam that regressed: the real core client decides whether a session mint
 * declares bearer transport, while the Next wrapper must bridge successfully
 * on both sides of that decision. The fake below implements the engine's gate
 * instead of gifting the wrapper a set-auth-token header.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthOwlClient,
  resolveConfig,
  SESSION_TOKEN_HEADER,
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
} from '@authowl/core';
import { APP_SESSION_BRIDGE_HEADER } from './bridge-contract';
import { createAuthOwlNextFetch } from './client';
import { createAuthOwlSessionBridge } from './session-bridge';

const API_URL = 'https://auth.example.com';
const APP_URL = 'https://app.example.com/api/authowl/session';
const SESSION_TOKEN = 'session-value.signature';
const SECRET_KEY = 'sk_test_11111111-1111-4111-8111-000000000000_validsecretkey';
const REJECTED_SECRET_KEY = 'sk_test_11111111-1111-4111-8111-000000000000_rejectedsecret';
const REDEEM_EXPIRES_AT = '2030-01-02T00:00:00.000Z';
const SESSION_EXPIRES_AT = '2030-01-01T00:00:00.000Z';
const USER = {
  id: 'user_1',
  email: 'owner@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

type EngineCall = Readonly<{
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}>;

type AppBridgePost =
  | { code: string; remember: boolean }
  | { token: null };

type AppBridgeResult = Readonly<{
  status: number;
  error: string | null;
  setCookie: string | null;
}>;

let projectCounter = 0;

function freshProject(): string {
  projectCounter += 1;
  return `11111111-1111-4111-8111-${String(projectCounter).padStart(12, '0')}`;
}

function codePosts(posts: AppBridgePost[]): Array<{ code: string; remember: boolean }> {
  return posts.filter((post): post is { code: string; remember: boolean } => 'code' in post);
}

function fakeEngine(
  projectId: string,
  cookieSupported: boolean,
  deploymentSecret: string,
) {
  const calls: EngineCall[] = [];
  const appBridgePosts: AppBridgePost[] = [];
  const appBridgeResults: AppBridgeResult[] = [];
  const mintedCodes = new Set<string>();
  let cookieSession = false;
  let mintCount = 0;

  const engineFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    let body: unknown;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    calls.push({ url: rawUrl, method, headers, body });

    if (rawUrl === '/api/authowl/session') {
      appBridgePosts.push(body as AppBridgePost);
      const requestHeaders = new Headers(init?.headers);
      requestHeaders.set('origin', 'https://app.example.com');
      requestHeaders.set('sec-fetch-site', 'same-origin');
      requestHeaders.set(APP_SESSION_BRIDGE_HEADER, '1');
      const bridgeResponse = await bridgeHandler(new Request(APP_URL, {
        method: 'POST',
        headers: requestHeaders,
        body: init?.body as BodyInit,
      }));
      const observed = bridgeResponse.clone();
      let error: string | null = null;
      if (observed.headers.get('content-type')?.includes('application/json')) {
        const payload = await observed.json() as { error?: unknown };
        error = typeof payload.error === 'string' ? payload.error : null;
      }
      appBridgeResults.push({
        status: bridgeResponse.status,
        error,
        setCookie: bridgeResponse.headers.get('set-cookie'),
      });
      return bridgeResponse;
    }

    const url = new URL(rawUrl);
    if (url.pathname === '/api/v1/sessions/bridge-code') {
      if (headers.get('authorization') !== `Bearer ${SECRET_KEY}`) {
        return Response.json({ error: 'rejected_key' }, { status: 401 });
      }
      const code = body && typeof body === 'object'
        ? (body as { code?: unknown }).code
        : undefined;
      if (typeof code !== 'string' || !mintedCodes.delete(code)) {
        return Response.json({ error: 'invalid_bridge_code' }, { status: 422 });
      }
      return Response.json({ token: SESSION_TOKEN, expiresAt: REDEEM_EXPIRES_AT });
    }

    if (url.pathname.endsWith('/session/cookie-capability')) {
      return method === 'POST'
        ? new Response(null, { status: 204 })
        : Response.json({ cookieSupported });
    }

    const declared = headers.get(SESSION_TRANSPORT_HEADER) === SESSION_TRANSPORT_BEARER;
    const bearerSession = declared
      && headers.get('authorization') === `Bearer ${SESSION_TOKEN}`
      && headers.has('x-authowl-session-proof');
    if (url.pathname.endsWith('/sign-in/email')) {
      if (cookieSupported) cookieSession = true;
      return Response.json(
        { redirect: false, user: USER },
        {
          headers: declared
            ? { [SESSION_TOKEN_HEADER]: SESSION_TOKEN }
            : undefined,
        },
      );
    }

    if (url.pathname.endsWith('/sign-out')) {
      const authenticated = cookieSession || bearerSession;
      cookieSession = false;
      return authenticated
        ? Response.json({ success: true })
        : Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (url.pathname.endsWith('/session/bridge-code')) {
      if (!cookieSession && !bearerSession) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      mintCount += 1;
      const code = `opaque bridge code ${mintCount}/+=`;
      mintedCodes.add(code);
      return Response.json({ code });
    }

    if (url.pathname.endsWith('/get-session')) {
      const serverPresentation =
        headers.get('authorization') === `Bearer ${SESSION_TOKEN}`
        && headers.get('x-authowl-secret-key') === SECRET_KEY;
      if (!serverPresentation && !cookieSession && !bearerSession) {
        return Response.json(null);
      }
      return Response.json({
        user: USER,
        session: {
          id: 'session_1',
          userId: USER.id,
          expiresAt: SESSION_EXPIRES_AT,
          pendingMfaEnrollment: false,
        },
      });
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
  }) as typeof fetch;

  const publishableKey = `pk_test_${projectId}_abcdefghijklmnopqrstuvwxyz012345`;
  // Declared after `engineFetch` because the two reference each other: the fake
  // engine routes the app-origin bridge path into this real handler, and the
  // handler needs the fake engine as its fetch. The closure only runs per
  // request, long after this initializer, so the forward reference is safe.
  const bridgeHandler = createAuthOwlSessionBridge({
    publishableKey,
    secretKey: deploymentSecret,
    apiUrl: API_URL,
    fetch: engineFetch,
  });

  return { fetch: engineFetch, calls, appBridgePosts, appBridgeResults };
}

type CoreClient = ReturnType<typeof createAuthOwlClient>;

async function signIn(client: CoreClient): Promise<void> {
  const result = await client.signIn.email({
    email: 'owner@example.com',
    password: 'correct-horse-battery-staple',
  });
  expect(result.error).toBeNull();
}

async function signInThroughNext(
  cookieSupported: boolean,
  deploymentSecret = SECRET_KEY,
) {
  const projectId = freshProject();
  const engine = fakeEngine(projectId, cookieSupported, deploymentSecret);
  const publishableKey = `pk_test_${projectId}_abcdefghijklmnopqrstuvwxyz012345`;
  const nextFetch = createAuthOwlNextFetch({
    publishableKey,
    apiUrl: API_URL,
    fetch: engine.fetch,
  });
  const client = createAuthOwlClient(resolveConfig({
    publishableKey,
    apiUrl: API_URL,
    fetch: nextFetch,
  }));

  await signIn(client);
  expect(codePosts(engine.appBridgePosts)).toHaveLength(1);
  return {
    client,
    engine,
    storageKey: `authowl:next-session-bridge:${projectId}`,
  };
}

describe('SDK-ENGINE SESSION BRIDGE CONTRACT', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('posts the bridge code after cookie-capable core transport signs in', async () => {
    const { engine } = await signInThroughNext(true);
    const signIn = engine.calls.find((call) => call.url.endsWith('/sign-in/email'))!;
    const mint = engine.calls.find((call) => call.url.endsWith('/session/bridge-code'))!;

    expect(signIn.headers.has(SESSION_TRANSPORT_HEADER)).toBe(false);
    expect(signIn.headers.has(SESSION_TOKEN_HEADER)).toBe(false);
    expect(mint.headers.has('authorization')).toBe(false);

    const redeem = engine.calls.find((call) => call.url.endsWith('/api/v1/sessions/bridge-code'))!;
    const validation = engine.calls.find((call) =>
      call.url.endsWith('/get-session')
      && call.headers.has('x-authowl-secret-key'))!;
    expect(redeem.headers.get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
    expect(validation.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(validation.headers.get('x-authowl-secret-key')).toBe(SECRET_KEY);
    expect(engine.appBridgeResults[0]).toMatchObject({ status: 204, error: null });
    expect(engine.appBridgeResults[0]!.setCookie).toContain(`Expires=${new Date(SESSION_EXPIRES_AT).toUTCString()}`);
  });

  it('posts the bridge code after sender-bound bearer core transport signs in', async () => {
    const { engine } = await signInThroughNext(false);
    const signIn = engine.calls.find((call) => call.url.endsWith('/sign-in/email'))!;
    const mint = engine.calls.find((call) => call.url.endsWith('/session/bridge-code'))!;

    expect(signIn.headers.get(SESSION_TRANSPORT_HEADER)).toBe(SESSION_TRANSPORT_BEARER);
    expect(mint.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(mint.headers.has('x-authowl-session-proof')).toBe(true);
  });

  it('surfaces and latches a rejected deployment key instead of minting forever', async () => {
    const { client, engine } = await signInThroughNext(true, REJECTED_SECRET_KEY);

    await client.getSession();
    await client.getSession();

    const mints = engine.calls.filter((call) => call.url.endsWith('/session/bridge-code'));
    expect(mints).toHaveLength(1);
    expect(codePosts(engine.appBridgePosts)).toHaveLength(1);
    expect(engine.appBridgeResults).toEqual([{
      status: 503,
      error: 'bridge_misconfigured',
      setCookie: null,
    }]);
  });

  it.each([
    ['cookie-capable', true],
    ['sender-bound bearer', false],
  ])('clears the app bridge when %s core transport signs out', async (_label, cookieSupported) => {
    const { client, engine, storageKey } = await signInThroughNext(cookieSupported);
    expect(sessionStorage.getItem(storageKey)).toBe('1');

    const result = await client.signOut();

    expect(result.error).toBeNull();
    expect(engine.appBridgePosts.at(-1)).toEqual({ token: null });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it.each([
    ['cookie-capable', true],
    ['sender-bound bearer', false],
  ])('re-bridges %s core transport with a fresh code after sign-out', async (_label, cookieSupported) => {
    const { client, engine, storageKey } = await signInThroughNext(cookieSupported);
    const firstCode = codePosts(engine.appBridgePosts)[0]!.code;

    const signedOut = await client.signOut();
    expect(signedOut.error).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    await signIn(client);

    const mints = engine.calls.filter((call) => call.url.endsWith('/session/bridge-code'));
    const bridged = codePosts(engine.appBridgePosts);
    expect(mints).toHaveLength(2);
    expect(bridged).toHaveLength(2);
    expect(bridged[1]!.code).not.toBe(firstCode);
  });

  it.each([
    ['cookie-capable', true],
    ['sender-bound bearer', false],
  ])('re-bridges a second %s sign-in without an intervening sign-out', async (_label, cookieSupported) => {
    const { client, engine } = await signInThroughNext(cookieSupported);
    const firstCode = codePosts(engine.appBridgePosts)[0]!.code;

    await signIn(client);

    const mints = engine.calls.filter((call) => call.url.endsWith('/session/bridge-code'));
    const bridged = codePosts(engine.appBridgePosts);
    expect(mints).toHaveLength(2);
    expect(bridged).toHaveLength(2);
    expect(bridged[1]!.code).not.toBe(firstCode);
  });
});
