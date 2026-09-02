import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SESSION_BRIDGE_HEADER, appSessionCookieNames } from './bridge-contract';
import {
  createAuthOwlSessionBridge,
  type AuthOwlSessionBridgeOptions,
} from './session-bridge';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const PUBLISHABLE_KEY = `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`;
const SECRET_KEY = `sk_live_${PROJECT_ID}_Z9y8X7w6V5u4T3s2R1q0`;
const API_URL = 'https://auth.example.com';
const APP_URL = 'https://app.example.com/api/authowl/session';
const CODE = 'opaque bridge/code+with=engine-owned-shape';
const TOKEN = 'session-token.signature';
const EXPIRES_AT = '2030-01-01T00:00:00.000Z';
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

function request(body: unknown, headers: Record<string, string> = {}): Request {
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
    body: JSON.stringify({ code: CODE }),
  });
}

function redeemedResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({ token: TOKEN, expiresAt: EXPIRES_AT, ...overrides });
}

function sessionResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    user: { id: 'user_1', email: 'owner@example.com' },
    session: {
      id: 'session_1',
      expiresAt: EXPIRES_AT,
      ...overrides,
    },
  });
}

function isRedeem(input: RequestInfo | URL): boolean {
  return new URL(String(input)).pathname === '/api/v1/sessions/bridge-code';
}

describe('createAuthOwlSessionBridge', () => {
  let remoteFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    remoteFetch = vi.fn<typeof fetch>(async (input) =>
      isRedeem(input) ? redeemedResponse() : sessionResponse());
  });

  it('redeems and validates a code before setting a host-only HttpOnly cookie', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE }));

    expect(result.status).toBe(204);
    expect(remoteFetch).toHaveBeenCalledTimes(2);
    const [redeemUrl, redeemInit] = remoteFetch.mock.calls[0]!;
    expect(redeemUrl).toBe(`${API_URL}/api/v1/sessions/bridge-code`);
    expect(new Headers(redeemInit?.headers).get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
    expect(JSON.parse(String(redeemInit?.body))).toEqual({ code: CODE });

    const [sessionUrl, sessionInit] = remoteFetch.mock.calls[1]!;
    expect(sessionUrl).toBe(`${API_URL}/api/projects/${PROJECT_ID}/auth/get-session`);
    const headers = new Headers(sessionInit?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('x-authowl-session-transport')).toBe('bearer');
    expect(headers.get('x-authowl-secret-key')).toBe(SECRET_KEY);
    expect(headers.get('x-publishable-key')).toBe(PUBLISHABLE_KEY);

    const cookie = result.headers.get('set-cookie') ?? '';
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

  it('rejects explicit bridge configuration without a secret at construction', () => {
    vi.stubEnv('AUTHOWL_SECRET_KEY', '');
    const incomplete = {
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    } as unknown as AuthOwlSessionBridgeOptions;

    expect(() => createAuthOwlSessionBridge(incomplete)).toThrow('AUTHOWL_SECRET_KEY');
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('latches deferred missing-secret configuration as bridge_misconfigured', async () => {
    vi.stubEnv('AUTHOWL_PUBLISHABLE_KEY', PUBLISHABLE_KEY);
    vi.stubEnv('AUTHOWL_API_URL', API_URL);
    vi.stubEnv('AUTHOWL_SECRET_KEY', '');
    const handler = createAuthOwlSessionBridge();

    const malformed = await handler(request({ code: 42 }));
    const first = await handler(request({ code: CODE }));
    vi.stubEnv('AUTHOWL_SECRET_KEY', SECRET_KEY);
    const latched = await handler(request({ code: CODE }));
    const clear = await handler(request({ token: null }));

    expect(malformed.status).toBe(400);
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toEqual({ error: 'bridge_misconfigured' });
    expect(latched.status).toBe(503);
    await expect(latched.json()).resolves.toEqual({ error: 'bridge_misconfigured' });
    expect(clear.status).toBe(503);
    expect(clear.headers.get('set-cookie')).toBeNull();
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('uses a session cookie when remember is false', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE, remember: false }));
    const cookie = result.headers.get('set-cookie') ?? '';

    expect(result.status).toBe(204);
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
      body: JSON.stringify({ code: CODE }),
    });
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(localRequest);
    const cookie = result.headers.get('set-cookie') ?? '';

    expect(cookie).toContain(`${appSessionCookieNames(PROJECT_ID).local}=${TOKEN}`);
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('__Host-');
  });

  it('ignores forwarding headers when the request URL already matches the browser origin', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request(
      { code: CODE },
      { host: 'app.example.com', 'x-forwarded-proto': 'http' },
    ));

    expect(result.status).toBe(204);
    expect(result.headers.get('set-cookie')).toContain(
      `${appSessionCookieNames(PROJECT_ID).secure}=${TOKEN}`,
    );
  });

  it.each(TRUSTED_PROXY_HEADERS)('accepts a same-origin browser POST behind a trusted reverse proxy', async (forwarded) => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });
    const result = await handler(proxiedRequest(forwarded));

    expect(result.status).toBe(204);
    expect(result.headers.get('set-cookie')).toContain(
      `${appSessionCookieNames(PROJECT_ID).secure}=${TOKEN}`,
    );
  });

  it('refuses a redeemed session still held for MFA enrollment', async () => {
    remoteFetch.mockImplementation(async (input) =>
      isRedeem(input) ? redeemedResponse() : sessionResponse({ pendingMfaEnrollment: true }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE }));

    expect(result.status).toBe(401);
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('returns invalid-session when a code is rejected or validation finds no live session', async () => {
    remoteFetch.mockResolvedValueOnce(Response.json({ error: 'invalid_code' }, { status: 422 }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const rejectedCode = await handler(request({ code: CODE }));
    expect(rejectedCode.status).toBe(401);

    remoteFetch.mockImplementation(async (input) =>
      isRedeem(input) ? redeemedResponse() : Response.json(null));
    const missingSession = await handler(request({ code: CODE }));
    expect(missingSession.status).toBe(401);
    expect(missingSession.headers.get('set-cookie')).toBeNull();
  });

  it.each([401, 403])('maps redeem status %s to bridge_misconfigured', async (status) => {
    remoteFetch.mockResolvedValueOnce(Response.json({ error: 'rejected_key' }, { status }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE }));

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toEqual({ error: 'bridge_misconfigured' });
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it.each(['network', 'server'])('maps a redeem %s failure to auth_service_unavailable', async (kind) => {
    if (kind === 'network') remoteFetch.mockRejectedValueOnce(new Error('offline'));
    else remoteFetch.mockResolvedValueOnce(Response.json({ error: 'down' }, { status: 500 }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE }));

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toEqual({ error: 'auth_service_unavailable' });
  });

  it('keeps get-session 401 mapped to invalid_session', async () => {
    remoteFetch
      .mockResolvedValueOnce(redeemedResponse())
      .mockResolvedValueOnce(Response.json({ error: 'unauthorized' }, { status: 401 }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE }));

    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({ error: 'invalid_session' });
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-date'],
    ['expired', '2020-01-01T00:00:00.000Z'],
  ])('refuses a session with a %s expiry', async (_case, expiresAt) => {
    remoteFetch.mockImplementation(async (input) =>
      isRedeem(input) ? redeemedResponse() : sessionResponse({ expiresAt }));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE }));

    expect(result.status).toBe(401);
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['malformed token', { token: 'not a valid cookie value; Path=/' }],
    ['missing expiry', { expiresAt: undefined }],
    ['expired', { expiresAt: '2020-01-01T00:00:00.000Z' }],
  ])('rejects an invalid redemption response: %s', async (_case, overrides) => {
    remoteFetch.mockResolvedValueOnce(redeemedResponse(overrides));
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ code: CODE }));

    expect(result.status).toBe(502);
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('refuses cross-origin, non-browser, and non-JSON writes before contacting AuthOwl', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const crossOrigin = await handler(request({ code: CODE }, { origin: 'https://evil.example' }));
    const missingMarker = await handler(request({ code: CODE }, { [APP_SESSION_BRIDGE_HEADER]: '0' }));
    const crossSite = await handler(request({ code: CODE }, { 'sec-fetch-site': 'cross-site' }));
    const nonJson = await handler(request({ code: CODE }, { 'content-type': 'text/plain' }));

    expect(crossOrigin.status).toBe(403);
    expect(missingMarker.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(nonJson.status).toBe(403);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it.each(REJECTED_PROXY_HEADERS)('refuses mismatched or ambiguous reverse-proxy origins', async (forwarded) => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });
    const result = await handler(proxiedRequest(forwarded));

    expect(result.status).toBe(403);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('refuses oversized codes and raw tokens without setting a cookie', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const oversized = await handler(request({ code: 'x'.repeat(20_000) }));
    const bounded = await handler(request({ code: 'x'.repeat(5_000) }));
    const rawToken = await handler(request({ token: TOKEN }));

    expect(oversized.status).toBe(413);
    expect(bounded.status).toBe(400);
    expect(rawToken.status).toBe(400);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('clears both secure and local cookie spellings without a remote request', async () => {
    const handler = createAuthOwlSessionBridge({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: API_URL,
      fetch: remoteFetch,
    });

    const result = await handler(request({ token: null }));

    expect(result.status).toBe(204);
    expect(remoteFetch).not.toHaveBeenCalled();
    const cookie = result.headers.get('set-cookie') ?? '';
    const names = appSessionCookieNames(PROJECT_ID);
    expect(cookie).toContain(`${names.secure}=`);
    expect(cookie).toContain(`${names.local}=`);
    expect(cookie).toContain('Max-Age=0');
  });
});
