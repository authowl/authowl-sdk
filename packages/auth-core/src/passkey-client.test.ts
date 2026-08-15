import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';
import type { AuthHttpClient } from './http-client';
import { createAuthHttpClient } from './http-client';
import { resolveConfig } from './config';
import { createPasskeyClient , explainCeremonyFailure } from './passkey-client';
import { browserPasskeyCeremony } from './passkey-browser';
import type { AuthHttpClient as PasskeyHttp } from './http-client';

/** The browser ceremony is now injected, so bind it once for these tests. */
const createBrowserPasskeyClient = (http: PasskeyHttp, sessionChanged: () => void) =>
  createPasskeyClient(http, sessionChanged, browserPasskeyCeremony);

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  WebAuthnError: class WebAuthnError extends Error {
    code: string;

    constructor(options: {
      message: string;
      code: string;
      cause: Error;
      name?: string;
    }) {
      super(options.message, { cause: options.cause });
      this.code = options.code;
      this.name = options.name ?? options.cause.name;
    }
  },
}));

const authenticationOptions = {
  challenge: 'AAAAAAAAAAAAAAAAAAAAAA',
  timeout: 60_000,
  rpId: 'app.example.test',
  userVerification: 'preferred',
  allowCredentials: [{
    id: 'Y3JlZGVudGlhbC0xMjM',
    type: 'public-key',
    transports: ['internal'],
  }],
  extensions: { credProps: true },
};

const registrationOptions = {
  challenge: 'BBBBBBBBBBBBBBBBBBBBBA',
  rp: { id: 'app.example.test', name: 'Example' },
  user: {
    id: 'dXNlci0x',
    name: 'mona@example.test',
    displayName: 'Mona',
  },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  timeout: 60_000,
  extensions: { credProps: true },
};
const browserAuthenticationResponse = {
  id: 'Y3JlZGVudGlhbC0xMjM',
  rawId: 'Y3JlZGVudGlhbC0xMjM',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'client_data',
    authenticatorData: 'authenticator_data',
    signature: 'signature',
  },
  clientExtensionResults: {},
};
const PK =
  'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';

describe('native passkey client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed when the server returns no ceremony options', async () => {
    const http = {
      request: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as AuthHttpClient;
    const result = await createBrowserPasskeyClient(http, vi.fn()).signIn();
    expect(result.error?.code).toBe('INVALID_WEBAUTHN_OPTIONS');
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('rejects an incomplete authentication response before verification', async () => {
    const request = vi.fn().mockResolvedValue({ data: authenticationOptions, error: null });
    const client = createPasskeyClient(
      { request } as AuthHttpClient,
      vi.fn(),
      {
        authenticate: vi.fn().mockResolvedValue({ id: 'credential-only' }),
        register: vi.fn(),
      } as never,
    );

    const result = await client.signIn();

    expect(result.error?.code).toBe('INVALID_WEBAUTHN_RESPONSE');
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects an incomplete registration response before verification', async () => {
    const request = vi.fn().mockResolvedValue({ data: registrationOptions, error: null });
    const client = createPasskeyClient(
      { request } as AuthHttpClient,
      vi.fn(),
      {
        authenticate: vi.fn(),
        register: vi.fn().mockResolvedValue({ id: 'credential-only' }),
      } as never,
    );

    const result = await client.add();

    expect(result.error?.code).toBe('INVALID_WEBAUTHN_RESPONSE');
    expect(request).toHaveBeenCalledOnce();
  });

  it('normalizes a cancelled browser ceremony without verifying', async () => {
    vi.mocked(startAuthentication).mockRejectedValueOnce(
      Object.assign(new Error('credential details must not escape'), {
        name: 'AbortError',
      }),
    );
    const request = vi.fn().mockResolvedValue({
      data: authenticationOptions,
      error: null,
    });
    const result = await createBrowserPasskeyClient({ request } as AuthHttpClient, vi.fn()).signIn();
    expect(result.data).toBeNull();
    expect(result.error?.status).toBe(400);
    expect(result.error?.message).toBe('Passkey authentication was cancelled.');
    expect(request).toHaveBeenCalledOnce();
  });

  it('classifies non-cancellation browser failures without reflecting details', async () => {
    vi.mocked(startAuthentication).mockRejectedValueOnce(
      new Error('WebAuthn is not supported; private browser detail'),
    );
    const request = vi.fn().mockResolvedValue({
      data: authenticationOptions,
      error: null,
    });

    const result = await createBrowserPasskeyClient(
      { request } as AuthHttpClient,
      vi.fn(),
    ).signIn();

    expect(result.error).toMatchObject({
      code: 'PASSKEY_BROWSER_ERROR',
      message: 'Passkey sign-in did not complete.',
    });
    expect(result.error?.message).not.toContain('private browser detail');
  });

  it('preserves the WebAuthn code, and explains what it means', async () => {
    vi.mocked(startRegistration).mockRejectedValueOnce(
      new WebAuthnError({
        message: 'RP detail must not escape',
        code: 'ERROR_INVALID_RP_ID',
        cause: new DOMException('private RP detail', 'SecurityError'),
      }),
    );
    const request = vi.fn().mockResolvedValue({
      data: registrationOptions,
      error: null,
    });

    const result = await createBrowserPasskeyClient(
      { request } as AuthHttpClient,
      vi.fn(),
    ).add({ name: 'Laptop' });

    expect(result.error).toMatchObject({
      code: 'ERROR_INVALID_RP_ID',
      // The code is machine-readable and unchanged; the MESSAGE now says what the
      // code means instead of blaming the browser for a domain misconfiguration.
      message: 'Passkeys are not set up for this site\u2019s domain.',
    });
    expect(result.error?.message).not.toContain('RP detail');
  });

  it('does not misreport verification or notification failures as browser cancellation', async () => {
    vi.mocked(startAuthentication)
      .mockResolvedValueOnce(browserAuthenticationResponse)
      .mockResolvedValueOnce(browserAuthenticationResponse);
    const verificationFailure = new Error('verification hook failed');
    const failingRequest = vi
      .fn()
      .mockResolvedValueOnce({ data: authenticationOptions, error: null })
      .mockRejectedValueOnce(verificationFailure);

    await expect(
      createBrowserPasskeyClient(
        { request: failingRequest } as AuthHttpClient,
        vi.fn(),
      ).signIn(),
    ).rejects.toBe(verificationFailure);

    const notificationFailure = new Error('notification failed');
    const validRequest = vi
      .fn()
      .mockResolvedValueOnce({ data: authenticationOptions, error: null })
      .mockResolvedValueOnce({
        data: {
          session: {
            id: 'session-1',
            userId: 'user-1',
            expiresAt: new Date('2026-07-26T09:00:00.000Z'),
          },
          user: {
            id: 'user-1',
            email: 'mona@example.test',
            emailVerified: true,
            createdAt: new Date('2026-07-26T08:00:00.000Z'),
            updatedAt: new Date('2026-07-26T08:00:00.000Z'),
          },
        },
        error: null,
      });

    await expect(
      createBrowserPasskeyClient(
        { request: validRequest } as AuthHttpClient,
        () => {
          throw notificationFailure;
        },
      ).signIn(),
    ).rejects.toBe(notificationFailure);
  });

  it('does not misreport registration or notification failures as browser cancellation', async () => {
    const browserRegistrationResponse = {
      id: 'Y3JlZGVudGlhbC00NTY',
      rawId: 'Y3JlZGVudGlhbC00NTY',
      type: 'public-key' as const,
      response: {
        clientDataJSON: 'client_data',
        attestationObject: 'attestation',
      },
      clientExtensionResults: {},
    };
    vi.mocked(startRegistration)
      .mockResolvedValueOnce(browserRegistrationResponse)
      .mockResolvedValueOnce(browserRegistrationResponse);
    const verificationFailure = new Error('registration hook failed');
    const failingRequest = vi
      .fn()
      .mockResolvedValueOnce({ data: registrationOptions, error: null })
      .mockRejectedValueOnce(verificationFailure);

    await expect(
      createBrowserPasskeyClient(
        { request: failingRequest } as AuthHttpClient,
        vi.fn(),
      ).add({ name: 'Laptop' }),
    ).rejects.toBe(verificationFailure);

    const notificationFailure = new Error('notification failed');
    const validRequest = vi
      .fn()
      .mockResolvedValueOnce({ data: registrationOptions, error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'passkey-1',
          name: 'Laptop',
          publicKey: 'QUJDRA==',
          userId: 'user-1',
          credentialID: 'Y3JlZGVudGlhbC00NTY',
          counter: 0,
          deviceType: 'singleDevice',
          backedUp: false,
          createdAt: new Date('2026-07-26T08:00:00.000Z'),
        },
        error: null,
      });

    await expect(
      createBrowserPasskeyClient(
        { request: validRequest } as AuthHttpClient,
        () => {
          throw notificationFailure;
        },
      ).add({ name: 'Laptop' }),
    ).rejects.toBe(notificationFailure);
  });

  it('surfaces an actionable error when WebAuthn rejects a background page', async () => {
    const focusError = Object.assign(new Error('Passkey registration failed'), {
      cause: new Error(
        'The operation is not allowed at this time because the page does not have focus.',
      ),
    });
    vi.mocked(startRegistration).mockRejectedValueOnce(focusError);
    const request = vi.fn().mockResolvedValue({
      data: registrationOptions,
      error: null,
    });

    const result = await createBrowserPasskeyClient({ request } as AuthHttpClient, vi.fn()).add();

    expect(result.error).toMatchObject({
      code: 'PASSKEY_PAGE_NOT_FOCUSED',
      message: 'Keep this page focused while completing the passkey prompt.',
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects malformed options before invoking the browser ceremony', async () => {
    const request = vi.fn().mockResolvedValue({
      data: { challenge: 'not base64url!', timeout: 60_000 },
      error: null,
    });

    const result = await createBrowserPasskeyClient(
      { request } as AuthHttpClient,
      vi.fn(),
    ).signIn();

    expect(result.error?.code).toBe('INVALID_WEBAUTHN_OPTIONS');
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it('keeps extension results out of the server-bound authentication response', async () => {
    const browserResponse = {
      ...browserAuthenticationResponse,
      clientExtensionResults: { credProps: { rk: true } },
    };
    vi.mocked(startAuthentication).mockResolvedValueOnce(browserResponse);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: authenticationOptions, error: null })
      .mockResolvedValueOnce({ data: { session: {}, user: {} }, error: null });

    await createBrowserPasskeyClient(
      { request } as AuthHttpClient,
      vi.fn(),
    ).signIn();

    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: authenticationOptions,
      useBrowserAutofill: undefined,
    });
    expect(request.mock.calls[1]?.[1]?.body).toEqual({
      response: {
        id: 'Y3JlZGVudGlhbC0xMjM',
        rawId: 'Y3JlZGVudGlhbC0xMjM',
        type: 'public-key',
        response: browserResponse.response,
      },
    });
  });

  it('collapses concurrent passkey verification into one session-minting request', async () => {
    vi.mocked(startAuthentication).mockResolvedValue(browserAuthenticationResponse);
    let releaseVerification: (() => void) | undefined;
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const verified = {
      data: {
        session: {
          id: 'session-1',
          userId: 'user-1',
          expiresAt: new Date('2026-07-26T09:00:00.000Z'),
        },
        user: {
          id: 'user-1',
          email: 'mona@example.test',
          emailVerified: true,
          createdAt: new Date('2026-07-26T08:00:00.000Z'),
          updatedAt: new Date('2026-07-26T08:00:00.000Z'),
        },
      },
      error: null,
    };
    const request = vi.fn(async (path: string) => {
      if (path === '/passkey/generate-authenticate-options') {
        return { data: authenticationOptions, error: null };
      }
      await verificationGate;
      return verified;
    });
    const sessionChanged = vi.fn();
    const client = createBrowserPasskeyClient(
      { request } as unknown as AuthHttpClient,
      sessionChanged,
    );

    const conditional = client.signIn({ autoFill: true });
    const explicit = client.signIn();

    await vi.waitFor(() => {
      expect(
        request.mock.calls.filter(
          ([path]) => path === '/passkey/verify-authentication',
        ),
      ).toHaveLength(1);
    });
    releaseVerification?.();

    await expect(Promise.all([conditional, explicit])).resolves.toEqual([
      verified,
      verified,
    ]);
    expect(sessionChanged).toHaveBeenCalledOnce();
  });

  it('keeps concurrent verification for different credentials independent', async () => {
    vi.mocked(startAuthentication)
      .mockResolvedValueOnce(browserAuthenticationResponse)
      .mockResolvedValueOnce({
        ...browserAuthenticationResponse,
        id: 'Y3JlZGVudGlhbC00NTY',
        rawId: 'Y3JlZGVudGlhbC00NTY',
      });
    const request = vi.fn(async (path: string) =>
      path === '/passkey/generate-authenticate-options'
        ? { data: authenticationOptions, error: null }
        : { data: { session: {}, user: {} }, error: null });
    const sessionChanged = vi.fn();
    const client = createBrowserPasskeyClient(
      { request } as unknown as AuthHttpClient,
      sessionChanged,
    );

    await Promise.all([client.signIn({ autoFill: true }), client.signIn()]);

    expect(
      request.mock.calls.filter(
        ([path]) => path === '/passkey/verify-authentication',
      ),
    ).toHaveLength(2);
    expect(sessionChanged).toHaveBeenCalledTimes(2);
  });

  it('keeps extension results out of the server-bound registration response', async () => {
    const browserResponse = {
      id: 'Y3JlZGVudGlhbC00NTY',
      rawId: 'Y3JlZGVudGlhbC00NTY',
      type: 'public-key' as const,
      response: {
        clientDataJSON: 'client_data',
        attestationObject: 'attestation',
      },
      clientExtensionResults: { credProps: { rk: true } },
    };
    vi.mocked(startRegistration).mockResolvedValueOnce(browserResponse);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: registrationOptions, error: null })
      .mockResolvedValueOnce({ data: { id: 'passkey-1' }, error: null });

    await createBrowserPasskeyClient(
      { request } as AuthHttpClient,
      vi.fn(),
    ).add({ name: '\u00a0Laptop\ufeff' });

    expect(request.mock.calls[0]?.[1]?.query?.name).toBe('Laptop');

    expect(startRegistration).toHaveBeenCalledWith({
      optionsJSON: registrationOptions,
    });
    expect(request.mock.calls[1]?.[1]?.body).toEqual({
      response: {
        id: 'Y3JlZGVudGlhbC00NTY',
        rawId: 'Y3JlZGVudGlhbC00NTY',
        type: 'public-key',
        response: browserResponse.response,
      },
      name: 'Laptop',
    });
  });

  it('rejects unsafe passkey names before generating registration options', async () => {
    const request = vi.fn();
    const client = createBrowserPasskeyClient(
      { request } as unknown as AuthHttpClient,
      vi.fn(),
    );

    for (const name of [
      '',
      '   ',
      '\u0085Laptop',
      'Laptop\u061c',
      'Laptop\u200e',
      'Laptop\u200f',
      'Laptop\u202e',
      'Laptop\ud800',
      'x'.repeat(257),
      '😀'.repeat(257),
    ]) {
      const result = await client.add({ name });
      expect(result).toMatchObject({
        data: null,
        error: { code: 'INVALID_PASSKEY_NAME', status: 400 },
      });
    }
    expect(request).not.toHaveBeenCalled();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('decodes verification before hooks and session notification', async () => {
    vi.mocked(startAuthentication)
      .mockResolvedValueOnce(browserAuthenticationResponse)
      .mockResolvedValueOnce(browserAuthenticationResponse);
    const timestamp = '2026-07-26T08:00:00.000Z';
    const responses = [
      authenticationOptions,
      { session: {}, user: {} },
      authenticationOptions,
      {
        session: {
          id: 'session-1',
          userId: 'user-1',
          expiresAt: timestamp,
        },
        user: {
          id: 'user-1',
          email: 'mona@example.test',
          emailVerified: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    ];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json(responses.shift()));
    const http = createAuthHttpClient(resolveConfig({
      publishableKey: PK,
      apiUrl: 'https://auth.example.test',
      fetch: fetchImpl,
    }));
    const sessionChanged = vi.fn();
    const invalidSuccess = vi.fn();
    const client = createBrowserPasskeyClient(http, sessionChanged);

    const invalid = await client.signIn({}, { onSuccess: invalidSuccess });
    expect(invalid).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(invalidSuccess).not.toHaveBeenCalled();
    expect(sessionChanged).not.toHaveBeenCalled();

    const validSuccess = vi.fn();
    const valid = await client.signIn({}, { onSuccess: validSuccess });
    expect(valid.data?.session.userId).toBe('user-1');
    expect(validSuccess).toHaveBeenCalledOnce();
    expect(sessionChanged).toHaveBeenCalledOnce();
  });

  it('does not notify for a malformed passkey registration response', async () => {
    vi.mocked(startRegistration).mockResolvedValueOnce({
      id: 'Y3JlZGVudGlhbC00NTY',
      rawId: 'Y3JlZGVudGlhbC00NTY',
      type: 'public-key',
      response: {
        clientDataJSON: 'client_data',
        attestationObject: 'attestation',
      },
      clientExtensionResults: {},
    });
    const responses = [registrationOptions, { id: 'passkey-1' }];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json(responses.shift()));
    const http = createAuthHttpClient(resolveConfig({
      publishableKey: PK,
      apiUrl: 'https://auth.example.test',
      fetch: fetchImpl,
    }));
    const sessionChanged = vi.fn();
    const onSuccess = vi.fn();

    const result = await createBrowserPasskeyClient(http, sessionChanged).add(
      { name: 'Laptop' },
      { onSuccess },
    );

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(sessionChanged).not.toHaveBeenCalled();
  });

  it('does not notify when registration returns a different credential', async () => {
    vi.mocked(startRegistration).mockResolvedValueOnce({
      id: 'Y3JlZGVudGlhbC00NTY',
      rawId: 'Y3JlZGVudGlhbC00NTY',
      type: 'public-key',
      response: {
        clientDataJSON: 'client_data',
        attestationObject: 'attestation',
      },
      clientExtensionResults: {},
    });
    const responses = [
      registrationOptions,
      {
        id: 'passkey-1',
        name: 'Laptop',
        publicKey: 'QUJDRA==',
        userId: 'user-1',
        credentialID: 'Y3JlZGVudGlhbC03ODk',
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: '2026-07-26T08:00:00.000Z',
      },
    ];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json(responses.shift()));
    const http = createAuthHttpClient(resolveConfig({
      publishableKey: PK,
      apiUrl: 'https://auth.example.test',
      fetch: fetchImpl,
    }));
    const sessionChanged = vi.fn();
    const onSuccess = vi.fn();

    const result = await createBrowserPasskeyClient(http, sessionChanged).add(
      { name: 'Laptop' },
      { onSuccess },
    );

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(sessionChanged).not.toHaveBeenCalled();
  });
});

describe('explaining why a passkey ceremony failed', () => {
  // Every non-cancel failure used to read "could not be completed by this
  // browser", which is wrong for a domain misconfiguration, wrong for a device
  // limit, and unhelpful for the ordinary case of not having a passkey yet.
  it('names a relying-party id that does not cover the page', () => {
    expect(explainCeremonyFailure('ERROR_INVALID_RP_ID', undefined, false))
      .toMatch(/not set up for this site/i);
    expect(explainCeremonyFailure(undefined, 'SecurityError', true))
      .toMatch(/not set up for this site/i);
  });

  it('names an authenticator that already holds a credential', () => {
    expect(explainCeremonyFailure('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', undefined, true))
      .toMatch(/already has a passkey/i);
  });

  it('names a device that cannot make one', () => {
    expect(explainCeremonyFailure('ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEY_ALGS', undefined, true))
      .toMatch(/cannot create a passkey/i);
  });

  // WebAuthn makes NotAllowedError ambiguous ON PURPOSE - cancelled, timed out
  // and no-matching-credential are indistinguishable so a site cannot probe which
  // passkeys you hold. The message covers the possibilities instead of asserting
  // one, and above all suggests the actionable one: you may not have registered.
  it('stays honestly vague about NotAllowedError, while naming the useful case', () => {
    const signIn = explainCeremonyFailure(undefined, 'NotAllowedError', false);
    expect(signIn).toMatch(/may not have one saved/i);
    expect(signIn).toMatch(/dismissed/i);

    expect(explainCeremonyFailure(undefined, 'NotAllowedError', true))
      .toMatch(/dismissed or timed out/i);
  });

  it('never blames the browser for any of them', () => {
    for (const code of [
      'ERROR_INVALID_RP_ID',
      'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED',
      'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEY_ALGS',
      undefined,
    ]) {
      for (const registering of [true, false]) {
        expect(explainCeremonyFailure(code, 'NotAllowedError', registering))
          .not.toMatch(/this browser/i);
      }
    }
  });
});
