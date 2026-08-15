import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import { getPublicConfig, type PublicConfig } from './public-config';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';

function cfg(fetchImpl: typeof fetch) {
  return resolveConfig({ publishableKey: PK, apiUrl: 'https://auth.example.com', fetch: fetchImpl });
}

function publicConfigFixture(): PublicConfig {
  return {
    applicationId: APPLICATION_ID,
    environmentId: PROJECT_ID,
    environmentType: 'production',
    authBaseUrl: `https://auth.example.com/api/projects/${PROJECT_ID}/auth`,
    branding: {
      appName: 'Acme',
      logoUrl: 'https://cdn.example.com/acme.svg',
      showAppName: true,
      alignment: 'right',
      theme: 'dark',
      primaryColor: '#0EA5A4',
    },
    enabledMethods: ['password', 'magic_link'],
    socialProviders: ['google'],
    socialProviderClientIds: { google: 'google-client-id.apps.googleusercontent.com' },
    requireEmailVerification: false,
    legal: { version: 1, required: false },
    twoFactor: false,
    mfaRequired: false,
    accountDeletion: false,
    organizations: true,
    sso: false,
    jwtIssuer: {
      issuer: `https://auth.example.com/api/projects/${PROJECT_ID}/auth`,
      jwksUrl: `https://auth.example.com/api/projects/${PROJECT_ID}/auth/jwks`,
      aud: PROJECT_ID,
    },
    turnstileSiteKey: '1x00000000000000000000AA',
    authTurnstileSiteKey: '1x00000000000000000000AA',
    locale: 'en',
    badge: true,
    configVersion: 3,
  };
}

describe('getPublicConfig', () => {
  it('rejects a JSON-looking success without a JSON content type', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          applicationId: APPLICATION_ID,
          environmentId: PROJECT_ID,
          environmentType: 'production',
          authBaseUrl: `https://auth.example.com/api/projects/${PROJECT_ID}/auth`,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    await expect(getPublicConfig(cfg(fetchImpl))).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'invalid_response',
    });
  });

  it('GETs the project public-config endpoint with the publishable key, no cookies', async () => {
    const body = publicConfigFixture();
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const out = await getPublicConfig(cfg(fetchImpl));
    expect(out).toEqual(body);

    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    const [url, init] = call;
    expect(url).toBe(`https://auth.example.com/api/projects/${PROJECT_ID}/public-config`);
    expect(new Headers(init.headers).get('x-publishable-key')).toBe(PK);
    expect(init.credentials).toBe('omit');
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 401, statusText: 'Unauthorized' }),
    ) as unknown as typeof fetch;
    await expect(getPublicConfig(cfg(fetchImpl))).rejects.toThrow(/401/);
  });

  it('accepts a bounded server-owned password policy', async () => {
    const body = {
      ...publicConfigFixture(),
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true, minLength: 12, maxLength: 96 },
        passkey: { signIn: false, add: false },
        username: { collectOnSignUp: false, signIn: false },
      },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(getPublicConfig(cfg(fetchImpl))).resolves.toMatchObject({
      authentication: { password: { minLength: 12, maxLength: 96 } },
    });
  });

  it.each([
    [{ minLength: 0, maxLength: 96 }],
    [{ minLength: 97, maxLength: 96 }],
    [{ minLength: 8 }],
    [{ minLength: 8, maxLength: 4097 }],
  ])('rejects an invalid password policy: %o', async (passwordPolicy) => {
    const body = {
      ...publicConfigFixture(),
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true, ...passwordPolicy },
        passkey: { signIn: false, add: false },
        username: { collectOnSignUp: false, signIn: false },
      },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(getPublicConfig(cfg(fetchImpl))).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'invalid_response',
    });
  });

  it.each([
    ['missing application id', { applicationId: undefined }],
    ['wrong environment id', { environmentId: APPLICATION_ID }],
    ['unsupported environment type', { environmentType: 'preview' }],
    [
      'cross-origin auth URL',
      { authBaseUrl: `https://attacker.example.com/api/projects/${PROJECT_ID}/auth` },
    ],
    [
      'insecure remote auth URL',
      { authBaseUrl: `http://auth.example.com/api/projects/${PROJECT_ID}/auth` },
    ],
  ])('rejects %s', async (_case, invalidIdentity) => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ...publicConfigFixture(),
          ...invalidIdentity,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    await expect(getPublicConfig(cfg(fetchImpl))).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'invalid_response',
    });
  });
});
