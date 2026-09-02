import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthOwlNextFetch } from './client';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const PUBLISHABLE_KEY = `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`;
const API_URL = 'https://auth.example.com';
const AUTH_URL = `${API_URL}/api/projects/${PROJECT_ID}/auth/sign-in/email`;
const GET_SESSION_URL = `${API_URL}/api/projects/${PROJECT_ID}/auth/get-session`;
const CAPABILITY_URL = `${API_URL}/api/projects/${PROJECT_ID}/auth/session/cookie-capability`;
const MINT_URL = `${API_URL}/api/projects/${PROJECT_ID}/auth/session/bridge-code`;
const SIGN_OUT_URL = `${API_URL}/api/projects/${PROJECT_ID}/auth/sign-out`;
const SESSION_TOKEN = 'session-token.signature';
const BRIDGE_CODE = 'opaque bridge/code+with=engine-owned-shape';

function tokenResponse(token = SESSION_TOKEN): Response {
  return Response.json(
    { redirect: false, user: { id: 'user_1' } },
    { headers: { 'set-auth-token': token } },
  );
}

function mintResponse(): Response {
  return Response.json({ code: BRIDGE_CODE });
}

describe('createAuthOwlNextFetch', () => {
  let calls: Array<{ input: RequestInfo | URL; init?: RequestInit }>;

  beforeEach(() => {
    calls = [];
  });

  it('mints and projects a code without consuming the caller response', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (String(input) === MINT_URL) return mintResponse();
      if (String(input) === '/api/authowl/session') return new Response(null, { status: 204 });
      return tokenResponse();
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    const response = await bridged(AUTH_URL, { method: 'POST' });

    await expect(response.json()).resolves.toMatchObject({ user: { id: 'user_1' } });
    expect(calls).toHaveLength(3);
    expect(calls[1]!.input).toBe(MINT_URL);
    expect(calls[2]!.input).toBe('/api/authowl/session');
    expect(new Headers(calls[2]!.init?.headers).get('x-authowl-session-bridge')).toBe('1');
    expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({
      code: BRIDGE_CODE,
      remember: true,
    });
  });

  it('preserves a session-only remember choice across an MFA challenge', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (String(input) === MINT_URL) return mintResponse();
      if (String(input) === '/api/authowl/session') return new Response(null, { status: 204 });
      if (calls.length === 1) return Response.json({ twoFactorRedirect: true });
      return tokenResponse();
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged(AUTH_URL, {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com', rememberMe: false }),
    });
    await bridged(`${API_URL}/api/projects/${PROJECT_ID}/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'x-authowl-challenge': `p_${PROJECT_ID.replace(/-/g, '')}.dont_remember=1`,
      },
      body: JSON.stringify({ code: '123456' }),
    });

    expect(calls).toHaveLength(4);
    expect(JSON.parse(String(calls[3]!.init?.body))).toEqual({
      code: BRIDGE_CODE,
      remember: false,
    });
  });

  it('does not leak a failed session-only intent into a later passwordless session', async () => {
    let authCalls = 0;
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (String(input) === MINT_URL) return mintResponse();
      if (String(input) === '/api/authowl/session') return new Response(null, { status: 204 });
      authCalls += 1;
      return authCalls === 1
        ? Response.json({ error: 'invalid password' }, { status: 401 })
        : tokenResponse();
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged(AUTH_URL, {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com', rememberMe: false }),
    });
    await bridged(`${API_URL}/api/projects/${PROJECT_ID}/auth/sign-in/email-otp`, {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com', otp: '123456' }),
    });

    expect(JSON.parse(String(calls[3]!.init?.body))).toEqual({
      code: BRIDGE_CODE,
      remember: true,
    });
  });

  it('clears the app-origin session only after a successful AuthOwl sign-out', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(null, { status: 204 });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged(SIGN_OUT_URL, { method: 'POST' });

    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ token: null });
  });

  it('does not clear the bridge when remote sign-out fails', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(null, { status: 401 });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged(SIGN_OUT_URL, { method: 'POST' });

    expect(calls).toHaveLength(1);
  });

  it('ensures the bridge once until a new session capability probe begins', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (String(input) === MINT_URL) return mintResponse();
      if (String(input) === '/api/authowl/session') return new Response(null, { status: 204 });
      if (String(input) === CAPABILITY_URL) return new Response(null, { status: 204 });
      return Response.json({ user: { id: 'user_1' }, session: { id: 'session_1' } });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await Promise.all([bridged(GET_SESSION_URL), bridged(GET_SESSION_URL)]);
    await bridged(CAPABILITY_URL, { method: 'POST' });
    await bridged(GET_SESSION_URL);

    expect(calls.filter((call) => String(call.input) === MINT_URL)).toHaveLength(2);
    expect(calls.filter((call) => String(call.input) === '/api/authowl/session')).toHaveLength(2);
  });

  it('swallows an older engine 404 and does not retry it on every request', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return String(input) === MINT_URL
        ? Response.json({ error: 'not_found' }, { status: 404 })
        : Response.json({ user: { id: 'user_1' }, session: { id: 'session_1' } });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await expect(bridged(GET_SESSION_URL)).resolves.toBeInstanceOf(Response);
    await expect(bridged(GET_SESSION_URL)).resolves.toBeInstanceOf(Response);

    expect(calls.filter((call) => String(call.input) === MINT_URL)).toHaveLength(1);
  });

  it.each([
    'request-password-reset',
    'send-verification-email',
    'sign-in/magic-link',
  ])('does not mint for the signed-out %s response', async (path) => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Response.json({ status: true });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged(`${API_URL}/api/projects/${PROJECT_ID}/auth/${path}`, { method: 'POST' });

    expect(calls).toHaveLength(1);
  });

  it('does not mint when email sign-up explicitly created no session', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Response.json({ sessionCreated: false, user: { id: 'user_1' } });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged(`${API_URL}/api/projects/${PROJECT_ID}/auth/sign-up/email`, { method: 'POST' });

    expect(calls).toHaveLength(1);
  });

  it('latches deployment misconfiguration but retries a transient bridge outage', async () => {
    for (const error of ['bridge_misconfigured', 'auth_service_unavailable']) {
      const localCalls: string[] = [];
      const base = vi.fn(async (input: RequestInfo | URL) => {
        localCalls.push(String(input));
        if (String(input) === MINT_URL) return mintResponse();
        if (String(input) === '/api/authowl/session') {
          return Response.json({ error }, { status: 503 });
        }
        return Response.json({ user: { id: 'user_1' }, session: { id: 'session_1' } });
      });
      const bridged = createAuthOwlNextFetch({
        publishableKey: PUBLISHABLE_KEY,
        apiUrl: API_URL,
        fetch: base,
      });

      await bridged(GET_SESSION_URL);
      await bridged(GET_SESSION_URL);

      const expectedAttempts = error === 'bridge_misconfigured' ? 1 : 2;
      expect(localCalls.filter((url) => url === MINT_URL)).toHaveLength(expectedAttempts);
      expect(localCalls.filter((url) => url === '/api/authowl/session')).toHaveLength(expectedAttempts);
    }
  });

  it('never rejects the caller because minting or projection failed', async () => {
    for (const failedPath of [MINT_URL, '/api/authowl/session']) {
      const base = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === MINT_URL) {
          return failedPath === MINT_URL
            ? Response.json({ error: 'unavailable' }, { status: 503 })
            : mintResponse();
        }
        if (String(input) === '/api/authowl/session') {
          return Response.json({ error: 'unavailable' }, { status: 503 });
        }
        return tokenResponse();
      });
      const bridged = createAuthOwlNextFetch({
        publishableKey: PUBLISHABLE_KEY,
        apiUrl: API_URL,
        fetch: base,
      });

      await expect(bridged(AUTH_URL, { method: 'POST' })).resolves.toBeInstanceOf(Response);
    }
  });

  it('ignores responses from every origin and project except its configured auth route', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return tokenResponse('attacker-token.signature');
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged('https://attacker.example/api/projects/11111111-2222-4333-8444-555555555555/auth/sign-in/email');
    await bridged(`${API_URL}/api/projects/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/auth/sign-in/email`);

    expect(calls).toHaveLength(2);
  });

  it.each(['//evil.example/steal', '/\\evil.example/steal', '/session#fragment'])(
    'rejects an unsafe bridge path: %s',
    (bridgePath) => {
      expect(() => createAuthOwlNextFetch({
        publishableKey: PUBLISHABLE_KEY,
        apiUrl: API_URL,
        bridgePath,
        fetch: vi.fn(),
      })).toThrow('bridgePath must be a same-origin absolute path');
    },
  );

  it('uses core policy to reject an insecure live API origin', () => {
    expect(() => createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: 'http://localhost:3010',
      fetch: vi.fn(),
    })).toThrow(/HTTPS/i);
  });
});
