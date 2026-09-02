import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import { getPublicConfig, type PublicConfig } from './public-config';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';

function cfg(fetchImpl: typeof fetch, apiUrl = 'https://auth.example.com') {
  return resolveConfig({ publishableKey: PK, apiUrl, fetch: fetchImpl });
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
    captcha: { provider: 'turnstile', siteKey: '1x00000000000000000000AA' },
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

  it('accepts a canonical JWT issuer when hosted auth uses a tenant origin', async () => {
    const hostedOrigin = `https://${PROJECT_ID}.accounts.authowl.dev`;
    const canonicalIssuer = `https://authowl.dev/api/projects/${PROJECT_ID}/auth`;
    const body = {
      ...publicConfigFixture(),
      authBaseUrl: `${hostedOrigin}/api/projects/${PROJECT_ID}/auth`,
      jwtIssuer: {
        issuer: canonicalIssuer,
        jwksUrl: `${canonicalIssuer}/jwks`,
        aud: PROJECT_ID,
      },
    };
    const fetchImpl = vi.fn(async () => Response.json(body)) as unknown as typeof fetch;

    await expect(getPublicConfig(cfg(fetchImpl, hostedOrigin))).resolves.toEqual(body);
  });

  it.each([
    [
      'an issuer path for another environment',
      {
        issuer: `https://authowl.dev/api/projects/${APPLICATION_ID}/auth`,
        jwksUrl: `https://authowl.dev/api/projects/${APPLICATION_ID}/auth/jwks`,
        aud: PROJECT_ID,
      },
    ],
    [
      'an issuer path below the environment auth endpoint',
      {
        issuer: `https://authowl.dev/api/projects/${PROJECT_ID}/auth/token`,
        jwksUrl: `https://authowl.dev/api/projects/${PROJECT_ID}/auth/token/jwks`,
        aud: PROJECT_ID,
      },
    ],
    [
      'a JWKS URL outside the issuer',
      {
        issuer: `https://authowl.dev/api/projects/${PROJECT_ID}/auth`,
        jwksUrl: `https://keys.example.com/api/projects/${PROJECT_ID}/auth/jwks`,
        aud: PROJECT_ID,
      },
    ],
    [
      'an insecure remote issuer',
      {
        issuer: `http://authowl.dev/api/projects/${PROJECT_ID}/auth`,
        jwksUrl: `http://authowl.dev/api/projects/${PROJECT_ID}/auth/jwks`,
        aud: PROJECT_ID,
      },
    ],
    [
      'an issuer with a query',
      {
        issuer: `https://authowl.dev/api/projects/${PROJECT_ID}/auth?tenant=other`,
        jwksUrl: `https://authowl.dev/api/projects/${PROJECT_ID}/auth/jwks`,
        aud: PROJECT_ID,
      },
    ],
    [
      'an audience for another environment',
      {
        issuer: `https://authowl.dev/api/projects/${PROJECT_ID}/auth`,
        jwksUrl: `https://authowl.dev/api/projects/${PROJECT_ID}/auth/jwks`,
        aud: APPLICATION_ID,
      },
    ],
  ])('rejects %s', async (_case, jwtIssuer) => {
    const hostedOrigin = `https://${PROJECT_ID}.accounts.authowl.dev`;
    const fetchImpl = vi.fn(async () => Response.json({
      ...publicConfigFixture(),
      authBaseUrl: `${hostedOrigin}/api/projects/${PROJECT_ID}/auth`,
      jwtIssuer,
    })) as unknown as typeof fetch;

    await expect(getPublicConfig(cfg(fetchImpl, hostedOrigin))).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'invalid_response',
    });
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

  it('validates the published bilingual privacy projection', async () => {
    const privacy = {
      notices: [{
        noticeId: '33333333-3333-4333-8333-333333333333',
        noticeVersionId: '44444444-4444-4444-8444-444444444444',
        code: 'signup_notice',
        version: 1,
        title: { en: 'Privacy', ar: 'الخصوصية' },
        body: { en: 'Notice body', ar: 'نص الإشعار' },
        digest: { en: 'a'.repeat(64), ar: 'b'.repeat(64) },
        activityCodes: ['account'],
        purposeCodes: ['research'],
        effectiveFrom: '2026-08-27T10:00:00.000Z',
      }],
      consentPurposes: [{
        purposeId: '55555555-5555-4555-8555-555555555555',
        purposeVersionId: '66666666-6666-4666-8666-666666666666',
        code: 'research',
        version: 1,
        title: { en: 'Research', ar: 'الأبحاث' },
        description: { en: 'Optional research', ar: 'أبحاث اختيارية' },
        digest: { en: 'c'.repeat(64), ar: 'd'.repeat(64) },
        activityCodes: ['account'],
        dataCategories: ['usage'],
      }],
    };
    const fetchImpl = vi.fn(
      async () => Response.json({ ...publicConfigFixture(), privacy }),
    ) as unknown as typeof fetch;
    await expect(getPublicConfig(cfg(fetchImpl))).resolves.toMatchObject({ privacy });

    const malformed = vi.fn(async () => Response.json({
      ...publicConfigFixture(),
      privacy: {
        ...privacy,
        notices: [{ ...privacy.notices[0], digest: { en: 'not-a-digest', ar: 'b'.repeat(64) } }],
      },
    })) as unknown as typeof fetch;
    await expect(getPublicConfig(cfg(malformed))).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'invalid_response',
    });
  });

  it('accepts explicit high-assurance MFA presentation capabilities', async () => {
    const body = {
      ...publicConfigFixture(),
      mfa: {
        totp: true,
        required: true,
        backupCodes: true,
        emailOtpFallback: false,
        trustDevice: false,
      },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(getPublicConfig(cfg(fetchImpl))).resolves.toMatchObject({ mfa: body.mfa });
  });

  it.each([
    { emailOtpFallback: 'false', trustDevice: false },
    { emailOtpFallback: false, trustDevice: 0 },
  ])('rejects malformed MFA presentation capabilities: %o', async (capabilities) => {
    const body = {
      ...publicConfigFixture(),
      mfa: {
        totp: true,
        required: true,
        backupCodes: true,
        ...capabilities,
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

describe('captcha config normalisation', () => {
  function decodeWith(extra: Record<string, unknown>) {
    const { captcha: _drop, ...base } = publicConfigFixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ...base, ...extra }),
    );
    return getPublicConfig(cfg(fetchImpl));
  }

  it('derives the generic shape from a server that only sends a Turnstile key', async () => {
    // The whole point of deriving here: every caller reads `config.captcha`, so
    // an older server does not force each component to remember the legacy field.
    await expect(decodeWith({})).resolves.toMatchObject({
      captcha: { provider: 'turnstile', siteKey: '1x00000000000000000000AA' },
    });
  });

  it('reports no challenge when the project has none', async () => {
    await expect(decodeWith({
      turnstileSiteKey: null,
      authTurnstileSiteKey: null,
    })).resolves.toMatchObject({ captcha: null });
  });

  it('carries a provider this build cannot render, rather than dropping it', async () => {
    // A silent null here is the failure that matters: the renderer would show
    // nothing, send no token, and the user would meet an unexplained 403. Keep
    // the slug so it can be named.
    await expect(decodeWith({
      captcha: { provider: 'some-future-provider', siteKey: 'sk-abc' },
    })).resolves.toMatchObject({
      captcha: { provider: 'some-future-provider', siteKey: 'sk-abc' },
    });
  });

  it('refuses a malformed challenge', async () => {
    await expect(decodeWith({ captcha: { provider: '', siteKey: 'x' } })).rejects.toThrow();
    await expect(decodeWith({ captcha: { provider: 'turnstile' } })).rejects.toThrow();
  });
});
