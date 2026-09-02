import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID_MIXED = '2F1C9A84-6B3D-4E57-9A10-5C8D7E2B4F60';
const PROJECT_ID = PROJECT_ID_MIXED.toLowerCase();
const MIXED_CASE_KEY = `pk_live_${PROJECT_ID_MIXED}_A1b2C3d4E5f6G7h8I9j0`;
const SECRET_KEY = `sk_live_${PROJECT_ID}_Z9y8X7w6V5u4T3s2R1q0`;

// The api URL is https, so `auth()` derives the SECURE cookie mode - the name
// the server sets in production.
const SERVER_COOKIE = `__Secure-p_${PROJECT_ID.replace(/-/g, '')}.session_token`;

const cookieJar: Array<{ name: string; value: string }> = [];

vi.mock('next/headers.js', () => ({
  cookies: async () => ({ getAll: () => cookieJar }),
  headers: async () => new Headers({ 'user-agent': 'vitest' }),
}));

const { appSessionCookieNames } = await import('./bridge-contract');
const { auth, hasAuthOwlSessionCookie, initAuth } = await import('./server');

describe('auth() project-id case', () => {
  let sentCookie: string | undefined;
  let sentUrl: string | undefined;
  let sentHeaders: Headers | undefined;

  beforeEach(() => {
    cookieJar.length = 0;
    sentCookie = undefined;
    sentUrl = undefined;
    sentHeaders = undefined;
    initAuth({
      publishableKey: MIXED_CASE_KEY,
      secretKey: SECRET_KEY,
      apiUrl: 'https://auth.example.com',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sentUrl = url;
        sentHeaders = new Headers(init.headers);
        sentCookie = sentHeaders.get('cookie') ?? undefined;
        return new Response(
          JSON.stringify({ user: { id: 'u1', email: 'a@b.c' }, session: { id: 's1', expiresAt: 'x' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
  });

  it('forwards the cookie the server actually set, given a mixed-case key', async () => {
    cookieJar.push({ name: SERVER_COOKIE, value: 'tok_1' });

    const session = await auth();

    // `auth()` forwards ONLY the cookie whose name it derived. An un-canonicalised
    // project id makes that filter match nothing, so the request goes out with an
    // empty cookie header and the auth server answers "not signed in" - correctly,
    // from its point of view, which is what makes the failure invisible.
    expect(sentCookie).toBe(`${SERVER_COOKIE}=tok_1`);
    expect(session?.user.id).toBe('u1');
  });

  it('addresses the project by its canonical lowercase id', async () => {
    cookieJar.push({ name: SERVER_COOKIE, value: 'tok_1' });

    await auth();

    // The split-out id is ALSO the request path, not just the cookie name, so
    // canonicalising the cookie alone would still send `/api/projects/2F1C…`.
    // Asserting the URL keeps this honest: a mock that only inspects headers
    // would happily pass while the SDK addressed a project id spelled in a way
    // the server never renders.
    expect(sentUrl).toBe(
      `https://auth.example.com/api/projects/${PROJECT_ID}/auth/get-session`,
    );
  });

  it('forwards nothing when the jar holds no matching cookie', async () => {
    cookieJar.push({ name: 'unrelated', value: '1' });

    await auth();

    // Guards the assertion above: proves the filter is doing real work rather
    // than forwarding whatever it finds.
    expect(sentCookie).toBe('');
  });

  it('forwards a validated app-origin bridge cookie through the paired bearer transport', async () => {
    cookieJar.push({ name: appSessionCookieNames(PROJECT_ID).secure, value: 'bridge-token.sig' });

    const session = await auth();

    expect(session?.user.id).toBe('u1');
    expect(sentCookie).toBe('');
    expect(sentHeaders?.get('authorization')).toBe('Bearer bridge-token.sig');
    expect(sentHeaders?.get('x-authowl-session-transport')).toBe('bearer');
    expect(sentHeaders?.get('x-authowl-secret-key')).toBe(SECRET_KEY);
  });

  it('prefers the native AuthOwl cookie when both transports are present', async () => {
    cookieJar.push(
      { name: SERVER_COOKIE, value: 'native-token' },
      { name: appSessionCookieNames(PROJECT_ID).secure, value: 'bridge-token.sig' },
    );

    await auth();

    expect(sentCookie).toBe(`${SERVER_COOKIE}=native-token`);
    expect(sentHeaders?.get('authorization')).toBeNull();
    expect(sentHeaders?.get('x-authowl-session-transport')).toBeNull();
    expect(sentHeaders?.get('x-authowl-secret-key')).toBeNull();
  });

  it('reports native and bridge cookie presence without exposing cookie-name internals', async () => {
    expect(await hasAuthOwlSessionCookie()).toBe(false);

    cookieJar.push({ name: appSessionCookieNames(PROJECT_ID).secure, value: 'bridge-token.sig' });

    expect(await hasAuthOwlSessionCookie()).toBe(true);
  });
});
