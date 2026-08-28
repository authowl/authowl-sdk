import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import { createAuthOwlClient } from './client';
import { createAuthActionClient, createNativeAuthClient } from './native-client';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async () => ({
    id: 'credential',
    rawId: 'credential',
    type: 'public-key',
    response: {
      clientDataJSON: 'client-data',
      authenticatorData: 'authenticator-data',
      signature: 'signature',
    },
    clientExtensionResults: {},
  })),
  startRegistration: vi.fn(async () => ({
    id: 'credential',
    rawId: 'credential',
    type: 'public-key',
    response: {
      clientDataJSON: 'client-data',
      attestationObject: 'attestation-object',
    },
    clientExtensionResults: {},
  })),
  WebAuthnError: class WebAuthnError extends Error {
    code = 'WEBAUTHN_ERROR';
  },
}));

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const CONSENT_URL = `https://auth.example.com/api/projects/${PROJECT_ID}/consent`;
const USER_WIRE = {
  id: 'user-1',
  email: 'mona@example.test',
  emailVerified: true,
  createdAt: '2026-07-26T08:00:00.000Z',
  updatedAt: '2026-07-26T08:00:00.000Z',
};
const PASSKEY_WIRE = {
  id: 'key',
  name: 'Key',
  publicKey: 'cHVibGljLWtleS1tYXRlcmlhbA==',
  userId: 'user-1',
  credentialID: 'Y3JlZGVudGlhbC0xMjM',
  counter: 0,
  deviceType: 'multiDevice',
  backedUp: true,
  transports: 'internal',
  createdAt: '2026-07-26T08:00:00.000Z',
  aaguid: '00000000-0000-0000-0000-000000000000',
};

function clientWith(fetchImpl: typeof fetch) {
  return createAuthOwlClient(
    resolveConfig({ publishableKey: PK, apiUrl: 'https://auth.example.com', fetch: fetchImpl }),
  );
}
function urls(fetchImpl: unknown): string[] {
  return (fetchImpl as { mock: { calls: [string | URL][] } }).mock.calls.map((c) => String(c[0]));
}

function validActionResponse(path: string): unknown {
  if (path.endsWith('/sign-up/email')) {
    return { sessionCreated: true, user: USER_WIRE };
  }
  if (path.endsWith('/sign-in/email')) {
    return { redirect: false, user: USER_WIRE };
  }
  if (path.endsWith('/sign-in/username')) {
    return { redirect: false, user: USER_WIRE };
  }
  if (path.endsWith('/sign-in/social')) {
    return {
      redirect: true,
      url: 'https://accounts.example.test/oauth/authorize',
    };
  }
  if (path.endsWith('/sign-in/magic-link')) return { status: true };
  if (path.endsWith('/email-otp/send-verification-otp')) return { success: true };
  if (path.endsWith('/email-otp/verify-email')) {
    return { status: true, user: USER_WIRE };
  }
  if (path.endsWith('/sign-in/email-otp')) return { user: USER_WIRE };
  if (path.endsWith('/phone-otp/start')) return { status: 'pending' };
  if (path.endsWith('/phone-otp/challenge')) return { kind: 'authowl_turnstile' };
  if (path.endsWith('/phone-otp/verify')) {
    return {
      status: true,
      sessionCreated: true,
      user: {
        id: 'phone-user',
        name: null,
        phoneNumber: '+201000000000',
        phoneNumberVerified: true,
      },
    };
  }
  if (
    path.endsWith('/request-password-reset')
    || path.endsWith('/reset-password')
    || path.endsWith('/send-verification-email')
  ) {
    return { status: true };
  }
  if (path.endsWith('/sign-out')) return { success: true };
  if (path.endsWith('/passkey/verify-authentication')) {
    return {
      session: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: '2026-07-26T09:00:00.000Z',
      },
      user: USER_WIRE,
    };
  }
  if (path.endsWith('/passkey/verify-registration')) return PASSKEY_WIRE;
  if (path.endsWith('/passkey/list-user-passkeys')) return [];
  if (path.endsWith('/passkey/update-passkey')) {
    return { passkey: { ...PASSKEY_WIRE, name: 'Renamed' } };
  }
  if (path.endsWith('/passkey/delete-passkey')) return { status: true };
  if (path.endsWith('/two-factor/enable')) {
    return {
      totpURI: 'otpauth://totp/AuthOwl:user?secret=ABC234&issuer=AuthOwl',
      backupCodes: ['alpha-1', 'bravo-2'],
    };
  }
  if (
    path.endsWith('/two-factor/verify-totp')
    || path.endsWith('/two-factor/verify-backup-code')
    || path.endsWith('/two-factor/verify-otp')
  ) {
    return { status: true };
  }
  if (
    path.endsWith('/two-factor/send-otp')
    || path.endsWith('/two-factor/disable')
  ) {
    return { status: true };
  }
  if (path.endsWith('/two-factor/generate-backup-codes')) {
    return { status: true, backupCodes: ['charlie-3', 'delta-4'] };
  }
  return { status: true, success: true, user: {}, session: {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAuthOwlClient social redirect wiring', () => {
  it('navigates the browser to the provider authorization URL', async () => {
    const authorizationUrl = 'https://accounts.example.com/oauth/authorize';
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchImpl = vi.fn(async () =>
      Response.json({ redirect: true, url: authorizationUrl }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).signIn.social({ provider: 'google' });

    expect(result.error).toBeNull();
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(authorizationUrl);
  });

  it('returns the authorization URL without navigating when redirects are disabled', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchImpl = vi.fn(async () =>
      Response.json({ redirect: false, url: 'https://accounts.example.com/oauth/authorize' }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).signIn.social({
      provider: 'google',
      disableRedirect: true,
    });

    expect(result.data?.redirect).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not navigate for an in-place provider ID-token exchange', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchImpl = vi.fn(async () =>
      Response.json({ redirect: false, user: USER_WIRE }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).signIn.social({
      provider: 'google',
      idToken: { token: 'google-id-token' },
    });

    expect(result.data?.redirect).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('createAuthOwlClient sso sign-in wiring', () => {
  it('POSTs /sign-in/sso with the body and navigates to the IdP authorization URL', async () => {
    const authorizationUrl =
      'https://idp.example.com/realms/acme/protocol/openid-connect/auth';
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchImpl = vi.fn(async () =>
      Response.json({ redirect: true, url: authorizationUrl }),
    ) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    const result = await client.signIn.sso({
      email: 'user@acme.test',
      callbackURL: 'https://app.example.test/after',
    });

    const [url, init] = (
      fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(
      `/api/projects/${PROJECT_ID}/auth/sign-in/sso`,
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'user@acme.test',
      callbackURL: 'https://app.example.test/after',
    });
    expect(result.error).toBeNull();
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(authorizationUrl);
  });

  it('rejects a non-redirect SSO response without navigating', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchImpl = vi.fn(async () =>
      Response.json({
        redirect: false,
        url: 'https://idp.example.com/authorize',
      }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).signIn.sso({
      providerId: 'acme-oidc',
      callbackURL: 'https://app.example.test/after',
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('INVALID_RESPONSE');
    expect(assign).not.toHaveBeenCalled();
  });

  it('surfaces a bare 404 (no connection for the domain) as an error without navigating', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchImpl = vi.fn(async () =>
      Response.json({ message: 'not found' }, { status: 404 }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).signIn.sso({
      email: 'user@no-sso.test',
      callbackURL: 'https://app.example.test/after',
    });

    expect(result.error?.status).toBe(404);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('auth action client session mutation wiring', () => {
  it('notifies only when a decoded response actually changes the session', async () => {
    const onSessionMutation = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        twoFactorRedirect: true,
        twoFactorMethods: ['totp'],
      }))
      .mockResolvedValueOnce(Response.json({
        sessionCreated: false,
        user: USER_WIRE,
      }))
      .mockResolvedValueOnce(Response.json({
        redirect: false,
        url: 'https://accounts.example.test/oauth/authorize',
      }))
      .mockResolvedValueOnce(Response.json({
        redirect: false,
        user: USER_WIRE,
      }))
      .mockResolvedValueOnce(Response.json({
        redirect: false,
        user: USER_WIRE,
      }))
      .mockResolvedValueOnce(Response.json({
        sessionCreated: true,
        user: USER_WIRE,
      }))
      .mockResolvedValueOnce(Response.json({ success: false }))
      .mockResolvedValueOnce(Response.json({ status: false }))
      .mockResolvedValueOnce(Response.json({ status: true }));
    const client = createAuthActionClient(
      resolveConfig({
        publishableKey: PK,
        apiUrl: 'https://auth.example.com',
        fetch: fetchImpl,
      }),
      onSessionMutation,
    );

    await client.signIn.email({
      email: 'u@example.test',
      password: 'password-1',
    });
    await client.signUp.email({
      email: 'u@example.test',
      password: 'password-1',
      name: 'User',
    });
    expect(onSessionMutation).not.toHaveBeenCalled();

    await client.signIn.social({
      provider: 'google',
      disableRedirect: true,
    });
    expect(onSessionMutation).not.toHaveBeenCalled();

    await client.signIn.social({
      provider: 'google',
      idToken: { token: 'google-id-token' },
    });
    expect(onSessionMutation).toHaveBeenCalledTimes(1);

    await client.signIn.email({
      email: 'u@example.test',
      password: 'password-1',
    });
    await client.signUp.email({
      email: 'u@example.test',
      password: 'password-1',
      name: 'User',
    });
    expect(onSessionMutation).toHaveBeenCalledTimes(3);

    await client.signOut();
    await client.twoFactor.disable({ password: 'password-1' });
    expect(onSessionMutation).toHaveBeenCalledTimes(3);

    await client.twoFactor.verifyTotp({ code: '123456' });
    expect(onSessionMutation).toHaveBeenCalledTimes(4);
  });

  it('blocks unsafe navigation before hooks and browser side effects', async () => {
    const assign = vi.fn();
    const onResponse = vi.fn();
    const onSuccess = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchImpl = vi.fn(async () =>
      Response.json({
        redirect: true,
        url: 'javascript:alert(document.cookie)',
      }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).signIn.social(
      { provider: 'google' },
      { onResponse, onSuccess },
    );

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(onResponse).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('rejects phone verification without the server session marker', async () => {
    const onSessionMutation = vi.fn();
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: true,
        user: {
          id: 'phone-user',
          phoneNumber: '+201000000000',
          phoneNumberVerified: true,
        },
      }),
    ) as unknown as typeof fetch;
    const client = createAuthActionClient(
      resolveConfig({
        publishableKey: PK,
        apiUrl: 'https://auth.example.com',
        fetch: fetchImpl,
      }),
      onSessionMutation,
    );

    const result = await client.phoneOtp.verify({
      phoneNumber: '01000000000',
      code: '123456',
    });

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(onSessionMutation).not.toHaveBeenCalled();
  });

  it('keeps intentional MFA secrets out of lifecycle and error contexts', async () => {
    const totpURI =
      'otpauth://totp/AuthOwl:user?secret=NEVER-IN-HOOKS&issuer=AuthOwl';
    const backupCode = 'never-in-hooks-backup';
    const contexts: unknown[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        totpURI,
        backupCodes: [backupCode],
      }))
      .mockResolvedValueOnce(Response.json({
        totpURI: 'https://invalid.example.test',
        backupCodes: [backupCode],
      }));
    const client = clientWith(fetchImpl);
    const options = {
      onResponse: (context: unknown) => contexts.push(context),
      onSuccess: (context: unknown) => contexts.push(context),
      onError: (context: unknown) => contexts.push(context),
    };

    const valid = await client.twoFactor.enable(
      { password: 'password-1' },
      options,
    );
    const invalid = await client.twoFactor.enable(
      { password: 'password-1' },
      options,
    );

    expect(valid.data).toEqual({ totpURI, backupCodes: [backupCode] });
    expect(invalid).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    const exposed = JSON.stringify({ contexts, error: invalid.error });
    expect(exposed).not.toContain('NEVER-IN-HOOKS');
    expect(exposed).not.toContain(backupCode);
  });
});

describe('native client boundary', () => {
  it('exposes ID-token social auth without redirect, SSO, or WebAuthn ceremonies', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) =>
      Response.json({ redirect: false, user: USER_WIRE }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = createNativeAuthClient(resolveConfig({
      publishableKey: PK,
      apiUrl: 'https://auth.example.com',
      fetch: fetchImpl,
    }));

    expect('sso' in client.signIn).toBe(false);
    expect('passkey' in client.signIn).toBe(false);
    expect('addPasskey' in client.passkey).toBe(false);
    expect(client.privacy).toMatchObject({
      listConsentPreferences: expect.any(Function),
      recordConsent: expect.any(Function),
      listRightsRequests: expect.any(Function),
      createRightsRequest: expect.any(Function),
    });

    const invalid = await (
      client.signIn.social as unknown as (
        params: { provider: string },
      ) => ReturnType<typeof client.signIn.social>
    )({ provider: 'google' });
    expect(invalid).toMatchObject({
      data: null,
      error: { code: 'NATIVE_SOCIAL_ID_TOKEN_REQUIRED' },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const result = await client.signIn.social({
      provider: 'google',
      idToken: { token: 'provider-id-token', nonce: 'provider-nonce' },
    });

    expect(result.error).toBeNull();
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: 'google',
      idToken: { token: 'provider-id-token', nonce: 'provider-nonce' },
      disableRedirect: true,
    });
  });

  it('fails closed if the server returns a redirect to an ID-token request', async () => {
    const client = createNativeAuthClient(resolveConfig({
      publishableKey: PK,
      apiUrl: 'https://auth.example.com',
      fetch: vi.fn(async () => Response.json({
        redirect: false,
        url: 'https://accounts.example.test/oauth/authorize',
      })) as unknown as typeof fetch,
    }));

    const result = await client.signIn.social({
      provider: 'google',
      idToken: { token: 'provider-id-token' },
    });

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_NATIVE_SOCIAL_RESPONSE' },
    });
  });
});

/**
 * Consent methods use the sibling `/consent` endpoint rather than the auth
 * action prefix. These tests pin that routing and the top-level return shape.
 */
describe('createAuthOwlClient consent wiring', () => {
  it('getConsentStatus() hits /consent (not an /auth route) and returns the top-level shape', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ required: true, needsConsent: true, version: 2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const out = await clientWith(fetchImpl).getConsentStatus();
    // Top-level fields prove this is the consent service, not an action envelope.
    expect(out).toEqual({ required: true, needsConsent: true, version: 2 });

    const called = urls(fetchImpl);
    expect(called).toContain(CONSENT_URL);
    expect(called.some((u) => u.includes('get-consent-status'))).toBe(false);
  });

  it('acceptConsent(version) POSTs the echoed version to /consent', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, version: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const out = await clientWith(fetchImpl).acceptConsent(2);
    expect(out).toEqual({ ok: true, version: 2 });

    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(
      ([u]) => String(u) === CONSENT_URL,
    );
    expect(call).toBeDefined();
    const [, init] = call!;
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toEqual({ version: 2 });
  });

  it('getToken() hits the jwt plugin GET /token, not a shadowed POST /get-token', async () => {
    // A plain string suffices: routing is under test, and undecodable tokens
    // are returned (just never cached).
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ token: 'jwt-from-server' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const out = await clientWith(fetchImpl).getToken();
    expect(out).toBe('jwt-from-server');

    const called = urls(fetchImpl);
    expect(called).toContain(`https://auth.example.com/api/projects/${PROJECT_ID}/auth/token`);
    // The dynamic route table would kebab-route a shadowed method to /get-token.
    expect(called.some((u) => u.includes('get-token'))).toBe(false);
  });

  it('every identity or token-claim mutation clears the token cache before dispatch', async () => {
    const jwt = (sub: string) =>
      `h.${btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 900 }))}.s`;
    let mints = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/auth/token')) {
        mints += 1;
        return new Response(JSON.stringify({ token: jwt(`user-${mints}`) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    // A malformed success response can arrive after the server has already
    // changed a cookie, identity, claim source, or revocation state. Every such
    // action must invalidate the cached backend JWT before the request.
    const actions: [string, () => Promise<unknown>][] = [
      ['signOut', () => client.signOut()],
      ['signIn.email', () => client.signIn.email({ email: 'b@x.co', password: 'pw-123456' })],
      ['signIn.username', () => client.signIn.username({
        username: 'mona',
        password: 'pw-123456',
      })],
      ['signIn.social ID token', () => client.signIn.social({
        provider: 'google',
        idToken: { token: 'google-id-token' },
      })],
      ['signIn.emailOtp', () => client.signIn.emailOtp({ email: 'b@x.co', otp: '123456' })],
      ['emailOtp.verifyEmail', () => client.emailOtp.verifyEmail({
        email: 'b@x.co',
        otp: '123456',
      })],
      ['phoneOtp.verify', () => client.phoneOtp.verify({ phoneNumber: '01000000000', code: '123456' })],
      ['signUp.email', () => client.signUp.email({ email: 'b@x.co', password: 'pw-123456', name: 'B' })],
      ['twoFactor.verifyTotp', () => client.twoFactor.verifyTotp({ code: '123456' })],
      ['twoFactor.verifyBackupCode', () => client.twoFactor.verifyBackupCode({ code: 'abc-def' })],
      ['twoFactor.verifyOtp', () => client.twoFactor.verifyOtp({ code: '123456' })],
      ['twoFactor.disable', () => client.twoFactor.disable({ password: 'password-1' })],
      ['account.changePassword', () => client.account.changePassword({
        currentPassword: 'password-1',
        newPassword: 'password-2',
        revokeOtherSessions: true,
      })],
      ['account.updateUnsafeMetadata', () => client.account.updateUnsafeMetadata({
        expectedVersion: 1,
        unsafeMetadata: { locale: 'ar' },
      })],
      ['account.updateProfile', () => client.account.updateProfile({ name: 'B' })],
      ['account.changeEmail', () => client.account.changeEmail({
        newEmail: 'b@example.test',
      })],
      ['account.revokeSession', () => client.account.revokeSession({
        sessionId: 'session-2',
      })],
      ['account.delete', () => client.account.delete({ password: 'password-2' })],
    ];
    for (const [name, act] of actions) {
      const before = await client.getToken();
      expect(await client.getToken(), `${name}: warm cache`).toBe(before);
      await act();
      expect(await client.getToken(), `${name}: must re-mint`).not.toBe(before);
    }
  });

  it('twoFactor.sendOtp/verifyOtp route to the engine 2FA endpoints with their bodies (B.5d)', async () => {
    // The outer Proxy replaces the WHOLE twoFactor namespace with refs captured
    // off the dynamic inner client, so a mis-capture would silently kebab-route
    // elsewhere - pin the URLs like getToken's test does.
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ status: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    await client.twoFactor.sendOtp({});
    await client.twoFactor.verifyOtp({ code: '123456', trustDevice: true });

    const calls = (fetchImpl as unknown as { mock: { calls: [string | URL, RequestInit?][] } }).mock
      .calls;
    const send = calls.find(([u]) => String(u).endsWith('/auth/two-factor/send-otp'));
    expect(send, 'sendOtp must POST /two-factor/send-otp').toBeDefined();
    expect(send![1]?.method).toBe('POST');
    const verify = calls.find(([u]) => String(u).endsWith('/auth/two-factor/verify-otp'));
    expect(verify, 'verifyOtp must POST /two-factor/verify-otp').toBeDefined();
    expect(verify![1]?.method).toBe('POST');
    expect(JSON.parse(String(verify![1]?.body))).toEqual({ code: '123456', trustDevice: true });
  });

  it('phoneOtp.start generates a UUID idempotency key when the caller omits one', async () => {
    const fetchImpl = vi.fn(
      async () => Response.json({ status: 'pending' }, { status: 202 }),
    ) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    await client.phoneOtp.start({ phoneNumber: '01000000000', turnstileToken: 'token' });

    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    const body = JSON.parse(String(call[1].body)) as Record<string, unknown>;
    expect(call[0]).toContain('/auth/phone-otp/start');
    expect(body).toMatchObject({ phoneNumber: '01000000000', turnstileToken: 'token' });
    expect(body.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('prepares the server-selected phone OTP guard without client credentials', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      kind: 'akedly_shield_v1_2',
      connectionId: '11111111-1111-4111-8111-111111111111',
      challenge: 'a'.repeat(64),
      difficulty: 4,
      challengeToken: 'signed.challenge.token',
      challengeRequired: true,
      turnstile: { required: true, siteKey: '0x-site' },
    })) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    const result = await client.phoneOtp.prepare();

    expect(result.data).toMatchObject({
      kind: 'akedly_shield_v1_2',
      difficulty: 4,
      turnstile: { required: true, siteKey: '0x-site' },
    });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toContain('/auth/phone-otp/challenge');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toBe('{}');
  });

  it('transports an auth challenge token only in the dedicated request header', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: true })) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    await client.signIn.email(
      { email: 'u@example.test', password: 'password-1' },
      { authChallengeToken: 'single-use-token', headers: { 'x-client': 'kept' } },
    );

    const [, init] = (
      fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get('x-authowl-turnstile-token')).toBe('single-use-token');
    expect(headers.get('x-client')).toBe('kept');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'u@example.test',
      password: 'password-1',
    });
  });

  it('never replays a single-use auth challenge token through transport retries', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}, { status: 503 })) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    await client.signIn.email(
      { email: 'u@example.test', password: 'password-1' },
      { authChallengeToken: 'single-use-token', retry: 3 },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('getSession({ disableCookieCache }) reaches /get-session with the query (the MFA-gate confirm)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ session: null, user: null }), { status: 200 }),
    ) as unknown as typeof fetch;

    await clientWith(fetchImpl).getSession({ query: { disableCookieCache: true } });
    const url = urls(fetchImpl).find((u) => u.includes('get-session'));
    expect(url).toBeDefined();
    expect(url).toContain('/auth/get-session');
    expect(url).toContain('disableCookieCache=true');
  });

  it('constructs an exact session DTO and rejects malformed authenticated state', async () => {
    const timestamp = '2026-07-26T08:00:00.000Z';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        session: {
          id: 'session-1',
          userId: 'user-1',
          expiresAt: timestamp,
          token: 'durable-session-secret',
          serverOnly: 'drop-me',
        },
        user: {
          id: 'user-1',
          email: 'mona@example.test',
          emailVerified: true,
          createdAt: timestamp,
          updatedAt: timestamp,
          privateMetadata: { operator: true },
        },
      }))
      .mockResolvedValueOnce(Response.json({
        session: { id: 'missing-user-and-dates' },
        user: {},
      }));
    const client = clientWith(fetchImpl);

    const valid = await client.getSession();
    expect(valid.data?.session.expiresAt).toBeInstanceOf(Date);
    expect(valid.data?.user.createdAt).toBeInstanceOf(Date);
    expect(valid.data).toEqual({
      session: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(timestamp),
      },
      user: {
        id: 'user-1',
        email: 'mona@example.test',
        emailVerified: true,
        createdAt: new Date(timestamp),
        updatedAt: new Date(timestamp),
      },
    });
    expect(JSON.stringify(valid.data)).not.toContain('durable-session-secret');
    expect(JSON.stringify(valid.data)).not.toContain('drop-me');
    expect(JSON.stringify(valid.data)).not.toContain('privateMetadata');

    await expect(client.getSession()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('preserves every organization role at the session decode boundary', async () => {
    const timestamp = '2026-07-26T08:00:00.000Z';
    const fetchImpl = vi.fn(async () => Response.json({
      session: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: timestamp,
        membership: {
          role: 'owner',
          roles: ['auditor', 'owner'],
          permissions: [],
        },
      },
      user: USER_WIRE,
    })) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).getSession();

    expect(result.error).toBeNull();
    expect(result.data?.session.membership).toEqual({
      role: 'owner',
      roles: ['auditor', 'owner'],
      permissions: [],
    });
  });

  it('fails closed on malformed passkey management responses before success hooks', async () => {
    const malformedPasskey = {
      ...PASSKEY_WIRE,
      deviceType: 'singleDevice',
      backedUp: true,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([malformedPasskey]))
      .mockResolvedValueOnce(Response.json({
        passkey: { ...PASSKEY_WIRE, name: 'Wrong name' },
      }))
      .mockResolvedValueOnce(Response.json({ status: false }));
    const client = clientWith(fetchImpl);
    const onSuccess = vi.fn();

    await expect(client.passkey.listUserPasskeys()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(client.passkey.updatePasskey(
      { id: 'key', name: 'Renamed' },
      { onSuccess },
    )).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(client.passkey.deletePasskey(
      { id: 'key' },
      { onSuccess },
    )).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('canonicalizes passkey rename input and rejects unsafe names before transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ passkey: { ...PASSKEY_WIRE, name: 'Renamed' } }),
    );
    const client = clientWith(fetchImpl);

    const renamed = await client.passkey.updatePasskey({
      id: 'key',
      name: '  Renamed  ',
    });
    expect(renamed.data?.passkey.name).toBe('Renamed');
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      id: 'key',
      name: 'Renamed',
    });

    for (const name of [
      '',
      'Name\u0000',
      'Name\u061c',
      'Name\u200e',
      'Name\ud800',
      'x'.repeat(257),
      '😀'.repeat(257),
    ]) {
      await expect(
        client.passkey.updatePasskey({ id: 'key', name }),
      ).resolves.toMatchObject({
        data: null,
        error: { code: 'INVALID_PASSKEY_NAME', status: 400 },
      });
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps the public AuthOwl action surface reachable', () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);
    expect(typeof client.signIn.email).toBe('function');
    expect(typeof client.signIn.username).toBe('function');
    expect(typeof client.phoneOtp.start).toBe('function');
    expect(typeof client.phoneOtp.verify).toBe('function');
    expect(typeof client.signOut).toBe('function');
    expect(typeof client.sessionStore.subscribe).toBe('function');
    expect(typeof client.sessionStore.getSnapshot).toBe('function');
    expect(typeof client.sessionStore.refresh).toBe('function');
  });

  it('routes every authentication action to the v1 wire endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/token')) return Response.json({ token: 'jwt' });
      if (path.endsWith('/consent')) return Response.json({ required: false, ok: true, version: 1 });
      if (path.includes('generate-register-options')) {
        return Response.json({
          challenge: 'AAAAAAAAAAAAAAAAAAAAAA',
          rp: { id: 'app.example.test', name: 'Example' },
          user: {
            id: 'dXNlci0x',
            name: 'u@example.test',
            displayName: 'User',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        });
      }
      if (path.includes('generate-authenticate-options')) {
        return Response.json({ challenge: 'AAAAAAAAAAAAAAAAAAAAAA' });
      }
      return Response.json(validActionResponse(path));
    }) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);
    const options = { headers: { 'x-test': 'yes' } };

    await client.signUp.email({ email: 'u@example.test', password: 'password-1', name: 'User' }, options);
    await client.signIn.email({ email: 'u@example.test', password: 'password-1' }, options);
    await client.signIn.username({ username: 'mona', password: 'password-1' }, options);
    await client.signIn.social({ provider: 'google' }, options);
    await client.signIn.magicLink({ email: 'u@example.test' }, options);
    await client.emailOtp.sendVerificationOtp({ email: 'u@example.test', type: 'sign-in' }, options);
    await client.emailOtp.verifyEmail({ email: 'u@example.test', otp: '123456' }, options);
    await client.signIn.emailOtp({ email: 'u@example.test', otp: '123456' }, options);
    await client.phoneOtp.start({
      phoneNumber: '01000000000',
      turnstileToken: 'turnstile',
      idempotencyKey: '11111111-2222-4333-8444-555555555555',
    }, options);
    await client.phoneOtp.verify({ phoneNumber: '01000000000', code: '123456' }, options);
    await client.signIn.passkey({}, options);
    await client.getSession();
    await client.signOut(options);
    await client.requestPasswordReset({ email: 'u@example.test' }, options);
    await client.resetPassword({ newPassword: 'password-2', token: 'reset' }, options);
    await client.sendVerificationEmail({ email: 'u@example.test' }, options);
    await client.passkey.addPasskey({ name: 'Key' }, options);
    await client.passkey.listUserPasskeys();
    await client.passkey.updatePasskey({ id: 'key', name: 'Renamed' }, options);
    await client.passkey.deletePasskey({ id: 'key' }, options);
    await client.twoFactor.enable({ password: 'password-1' }, options);
    await client.twoFactor.verifyTotp({ code: '123456' }, options);
    await client.twoFactor.verifyBackupCode({ code: 'backup' }, options);
    await client.twoFactor.sendOtp({}, options);
    await client.twoFactor.verifyOtp({ code: '123456' }, options);
    await client.twoFactor.generateBackupCodes({ password: 'password-1' }, options);
    await client.twoFactor.disable({ password: 'password-1' }, options);
    await client.getToken({ forceRefresh: true });
    await client.getConsentStatus();
    await client.acceptConsent(1);
    await client.waitlist.join(
      { email: 'u@example.test' },
      { authChallengeToken: 'waitlist-challenge' },
    );

    const exchanges = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.map(
      ([url, init]) => `${init.method ?? 'GET'} ${new URL(String(url)).pathname}`,
    );
    expect(exchanges).toEqual([
      `POST /api/projects/${PROJECT_ID}/auth/sign-up/email`,
      `POST /api/projects/${PROJECT_ID}/auth/sign-in/email`,
      `POST /api/projects/${PROJECT_ID}/auth/sign-in/username`,
      `POST /api/projects/${PROJECT_ID}/auth/sign-in/social`,
      `POST /api/projects/${PROJECT_ID}/auth/sign-in/magic-link`,
      `POST /api/projects/${PROJECT_ID}/auth/email-otp/send-verification-otp`,
      `POST /api/projects/${PROJECT_ID}/auth/email-otp/verify-email`,
      `POST /api/projects/${PROJECT_ID}/auth/sign-in/email-otp`,
      `POST /api/projects/${PROJECT_ID}/auth/phone-otp/start`,
      `POST /api/projects/${PROJECT_ID}/auth/phone-otp/verify`,
      `GET /api/projects/${PROJECT_ID}/auth/passkey/generate-authenticate-options`,
      `POST /api/projects/${PROJECT_ID}/auth/passkey/verify-authentication`,
      `GET /api/projects/${PROJECT_ID}/auth/get-session`,
      `POST /api/projects/${PROJECT_ID}/auth/sign-out`,
      `POST /api/projects/${PROJECT_ID}/auth/request-password-reset`,
      `POST /api/projects/${PROJECT_ID}/auth/reset-password`,
      `POST /api/projects/${PROJECT_ID}/auth/send-verification-email`,
      `GET /api/projects/${PROJECT_ID}/auth/passkey/generate-register-options`,
      `POST /api/projects/${PROJECT_ID}/auth/passkey/verify-registration`,
      `GET /api/projects/${PROJECT_ID}/auth/passkey/list-user-passkeys`,
      `POST /api/projects/${PROJECT_ID}/auth/passkey/update-passkey`,
      `POST /api/projects/${PROJECT_ID}/auth/passkey/delete-passkey`,
      `POST /api/projects/${PROJECT_ID}/auth/two-factor/enable`,
      `POST /api/projects/${PROJECT_ID}/auth/two-factor/verify-totp`,
      `POST /api/projects/${PROJECT_ID}/auth/two-factor/verify-backup-code`,
      `POST /api/projects/${PROJECT_ID}/auth/two-factor/send-otp`,
      `POST /api/projects/${PROJECT_ID}/auth/two-factor/verify-otp`,
      `POST /api/projects/${PROJECT_ID}/auth/two-factor/generate-backup-codes`,
      `POST /api/projects/${PROJECT_ID}/auth/two-factor/disable`,
      `GET /api/projects/${PROJECT_ID}/auth/token`,
      `GET /api/projects/${PROJECT_ID}/consent`,
      `POST /api/projects/${PROJECT_ID}/consent`,
      `POST /api/projects/${PROJECT_ID}/waitlist`,
    ]);
    const signOutCall = (
      fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/sign-out'));
    expect(signOutCall?.[1].headers).toBeDefined();
    expect(JSON.parse(String(signOutCall?.[1].body))).toEqual({});
    const waitlistCall = (
      fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/waitlist'));
    expect(waitlistCall?.[1].credentials).toBe('omit');
    expect(new Headers(waitlistCall?.[1].headers).get('x-authowl-turnstile-token'))
      .toBe('waitlist-challenge');
    expect(JSON.parse(String(waitlistCall?.[1].body))).toEqual({
      email: 'u@example.test',
    });
  });
});
