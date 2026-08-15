import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SESSION_BRIDGE_HEADER, appSessionCookieNames } from './bridge-contract';
import { createAuthOwlSessionBridge } from './session-bridge';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const PUBLISHABLE_KEY = `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`;
const API_URL = 'https://auth.example.com';
const APP_URL = 'https://app.example.com/api/authowl/session';
const TOKEN = 'session-token.signature';
const TRUSTED_PROXY_HEADERS: Array<Record<string, string>> = [
  { host: 'app.example.com', 'x-forwarded-proto': 'https' },
  { 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' },
];
const REJECTED_PROXY_HEADERS: Array<Record<string, string>> = [
  { host: 'evil.example', 'x-forwarded-proto': 'https' },
  { host: 'app.example.com', 'x-forwarded-proto': 'http' },
  { host: 'app.example.com', 'x-forwarded-proto': 'https,http' },
  { 'x-forwarded-host': 'app.example.com,evil.example', 'x-forwarded-proto': 'https' },
];

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(APP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.example.com',
      'sec-fetch-site': 'same-origin',
      [APP_SESSION_BRIDGE_HEADER]: '1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function proxiedRequest(forwarded: Record<string, string>): Request {
  return new Request('http://web:3000/api/authowl/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.example.com',
      'sec-fetch-site': 'same-origin',
      [APP_SESSION_BRIDGE_HEADER]: '1',
      ...forwarded,
    },
    body: JSON.stringify({ token: TOKEN }),
  });
}

function sessionResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    user: { id: 'user_1', email: 'owner@example.com' },
    session: {
      id: 'session_1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      ...overrides,
    },
  });
}

describe('createAuthOwlSessionBridge', () => {
  let remoteFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    remoteFetch = vi.fn<typeof fetch>(async () => sessionResponse());
  });

  it('validates the bearer session against AuthOwl before setting a host-only HttpOnly cookie', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(request({ token: TOKEN }));

    expect(response.status).toBe(204);
    expect(remoteFetch).toHaveBeenCalledOnce();
    const [url, init] = remoteFetch.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/api/projects/${PROJECT_ID}/auth/get-session`);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('x-authowl-session-transport')).toBe('bearer');
    expect(headers.get('x-publishable-key')).toBe(PUBLISHABLE_KEY);

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${appSessionCookieNames(PROJECT_ID).secure}=${TOKEN}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
  });

  it('defers environment configuration until the route receives a request', () => {
    expect(() => createAuthOwlSessionBridge()).not.toThrow();
  });

  it('uses a session cookie when remember is false', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(request({ token: TOKEN, remember: false }));
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(204);
    expect(cookie).not.toContain('Expires=');
    expect(cookie).not.toContain('Max-Age=');
  });

  it('uses the non-secure host-only spelling for local HTTP development', async () => {
    const localRequest = new Request('http://localhost:3000/api/authowl/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
        [APP_SESSION_BRIDGE_HEADER]: '1',
      },
      body: JSON.stringify({ token: TOKEN }),
    });
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(localRequest);
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(cookie).toContain(`${appSessionCookieNames(PROJECT_ID).local}=${TOKEN}`);
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('__Host-');
  });

  it('ignores forwarding headers when the request URL already matches the browser origin', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(request(
      { token: TOKEN },
      { host: 'app.example.com', 'x-forwarded-proto': 'http' },
    ));

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain(
      `${appSessionCookieNames(PROJECT_ID).secure}=${TOKEN}`,
    );
  });

  it.each(TRUSTED_PROXY_HEADERS)('accepts a same-origin browser POST behind a trusted reverse proxy', async (forwarded) => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });
    const response = await handler(proxiedRequest(forwarded));

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain(
      `${appSessionCookieNames(PROJECT_ID).secure}=${TOKEN}`,
    );
  });

  it('refuses a token whose session is still held for MFA enrollment', async () => {
    remoteFetch.mockResolvedValueOnce(sessionResponse({ pendingMfaEnrollment: true }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(request({ token: TOKEN }));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns an invalid-session response when AuthOwl reports no bearer session', async () => {
    remoteFetch.mockResolvedValueOnce(Response.json(null));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(request({ token: TOKEN }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_session' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-date'],
    ['expired', '2020-01-01T00:00:00.000Z'],
  ])('refuses a session with a %s expiry', async (_case, expiresAt) => {
    remoteFetch.mockResolvedValueOnce(sessionResponse({ expiresAt }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(request({ token: TOKEN }));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses cross-origin and non-browser writes before contacting AuthOwl', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const crossOrigin = await handler(request({ token: TOKEN }, { origin: 'https://evil.example' }));
    const missingMarker = await handler(request({ token: TOKEN }, { [APP_SESSION_BRIDGE_HEADER]: '0' }));
    const crossSite = await handler(request({ token: TOKEN }, { 'sec-fetch-site': 'cross-site' }));

    expect(crossOrigin.status).toBe(403);
    expect(missingMarker.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it.each(REJECTED_PROXY_HEADERS)('refuses mismatched or ambiguous reverse-proxy origins', async (forwarded) => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });
    const response = await handler(proxiedRequest(forwarded));

    expect(response.status).toBe(403);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('refuses oversized or malformed credentials without setting a cookie', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const oversized = await handler(request({ token: 'x'.repeat(20_000) }));
    const malformed = await handler(request({ token: 'not a valid cookie value; Path=/' }));

    expect(oversized.status).toBe(413);
    expect(malformed.status).toBe(400);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('clears both secure and local cookie spellings without a remote request', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const response = await handler(request({ token: null }));

    expect(response.status).toBe(204);
    expect(remoteFetch).not.toHaveBeenCalled();
    const cookie = response.headers.get('set-cookie') ?? '';
    const names = appSessionCookieNames(PROJECT_ID);
    expect(cookie).toContain(`${names.secure}=`);
    expect(cookie).toContain(`${names.local}=`);
    expect(cookie).toContain('Max-Age=0');
  });
});
