import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthOwlNextSessionBridgeError,
  createAuthOwlNextFetch,
} from './client';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const PUBLISHABLE_KEY = `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`;
const API_URL = 'https://auth.example.com';
const AUTH_URL = `${API_URL}/api/projects/${PROJECT_ID}/auth/sign-in/email`;
const SIGN_OUT_URL = `${API_URL}/api/projects/${PROJECT_ID}/auth/sign-out`;
const SESSION_TOKEN = 'session-token.signature';

function tokenResponse(token = SESSION_TOKEN): Response {
  return Response.json(
    { user: { id: 'user_1' } },
    { headers: { 'set-auth-token': token } },
  );
}

describe('createAuthOwlNextFetch', () => {
  let calls: Array<{ input: RequestInfo | URL; init?: RequestInit }>;

  beforeEach(() => {
    calls = [];
  });

  it('projects a newly issued AuthOwl session before returning the auth response', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return calls.length === 1 ? tokenResponse() : new Response(null, { status: 204 });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    const response = await bridged(AUTH_URL, { method: 'POST' });

    expect(response.headers.get('set-auth-token')).toBe(SESSION_TOKEN);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.input).toBe('/api/authowl/session');
    expect(new Headers(calls[1]!.init?.headers).get('x-authowl-session-bridge')).toBe('1');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      token: SESSION_TOKEN,
      remember: true,
    });
  });

  it('preserves a session-only remember choice across an MFA challenge', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) return Response.json({ twoFactorRedirect: true });
      if (calls.length === 2) return tokenResponse();
      return new Response(null, { status: 204 });
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

    expect(calls).toHaveLength(3);
    expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({
      token: SESSION_TOKEN,
      remember: false,
    });
  });

  it('does not leak a failed session-only intent into a later passwordless session', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) return Response.json({ error: 'invalid password' }, { status: 401 });
      if (calls.length === 2) return tokenResponse();
      return new Response(null, { status: 204 });
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

    expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({
      token: SESSION_TOKEN,
      remember: true,
    });
  });

  it('clears the app-origin session only after a successful AuthOwl sign-out', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(null, { status: calls.length === 1 ? 204 : 204 });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await bridged(SIGN_OUT_URL, { method: 'POST' });

    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ token: null, remember: true });
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

  it('ignores token-shaped headers from every origin and project except its configured auth route', async () => {
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

  it('fails the sign-in instead of redirecting into a server-side login loop when projection fails', async () => {
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return calls.length === 1
        ? tokenResponse()
        : Response.json({ error: 'unavailable' }, { status: 503 });
    });
    const bridged = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    await expect(bridged(AUTH_URL, { method: 'POST' })).rejects.toBeInstanceOf(
      AuthOwlNextSessionBridgeError,
    );
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
