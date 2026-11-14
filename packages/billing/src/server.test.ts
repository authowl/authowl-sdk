import {
  AuthorizationError,
  isAuthorizationError,
} from '@authowl/core/server';
import { AuthServiceError, auth } from '@authowl/next/server';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  BillingUnavailableError,
  FeatureDeniedError,
  checkFeature,
  hasFeature,
  requireFeature,
} from './server';
import { ORG_ID, USER_ID } from './test-fixtures';

vi.mock('@authowl/next/server', async (importOriginal) => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- The mock preserves runtime exports.
  ...((await importOriginal()) as typeof import('@authowl/next/server')),
  auth: vi.fn(),
}));

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const SECRET_KEY = ['sk_test', PROJECT_ID, 'billingserverfixture'].join('_');
const API_URL = 'https://auth.example.test';
const BILLING_URL = `${API_URL}/api/v1/billing/check`;
const authMock = vi.mocked(auth);

const allowed = {
  feature: 'reports',
  allowed: true,
  kind: 'boolean',
  balance: null,
  reason: null,
  source: 'live',
  subject: { type: 'user', id: USER_ID },
} as const;

function options(fetch: typeof globalThis.fetch) {
  return { secretKey: SECRET_KEY, apiUrl: API_URL, fetch };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function replying(make: () => Response) {
  return vi.fn<typeof globalThis.fetch>(async () => make());
}

function sentBody(fetch: ReturnType<typeof replying>): unknown {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
}

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({
    type: 'https://auth.example.test/problems/request',
    title: 'Request rejected',
    status,
    detail: 'The request was rejected.',
    instance: 'urn:authowl:request:billing-fixture',
    code,
  }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function signedIn(organizationId: string | null = ORG_ID) {
  authMock.mockResolvedValue({
    user: { id: USER_ID, email: 'billing@example.test' },
    session: {
      id: '00000000-0000-4000-8000-000000000004',
      expiresAt: '2026-11-15T00:00:00.000Z',
      activeOrganizationId: organizationId,
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('checkFeature', () => {
  it('sends one Admin API request and removes the subject from the result', async () => {
    const fetch = replying(() => json(allowed));
    await expect(checkFeature({ feature: 'reports', userId: USER_ID }, options(fetch)))
      .resolves.toEqual({
        feature: 'reports',
        allowed: true,
        kind: 'boolean',
        balance: null,
        reason: null,
        source: 'live',
      });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(BILLING_URL);
    expect(init?.method).toBe('POST');
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(sentBody(fetch)).toEqual({ feature: 'reports', userId: USER_ID });
  });

  it('includes organizationId only when it is defined', async () => {
    const fetch = replying(() => json(allowed));
    await checkFeature(
      { feature: 'reports', userId: USER_ID, organizationId: ORG_ID },
      options(fetch),
    );
    expect(sentBody(fetch)).toEqual({
      feature: 'reports',
      userId: USER_ID,
      organizationId: ORG_ID,
    });
  });

  it('uses the environment fallbacks', async () => {
    vi.stubEnv('AUTHOWL_SECRET_KEY', SECRET_KEY);
    vi.stubEnv('AUTHOWL_API_URL', API_URL);
    const fetch = replying(() => json(allowed));
    await checkFeature({ feature: 'reports', userId: USER_ID }, { fetch });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(BILLING_URL);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe(`Bearer ${SECRET_KEY}`);
  });

  it.each([undefined, null, 42, ['reports']])(
    'rejects a non-string feature before transport: %j',
    async (feature) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      await expect(checkFeature({ feature: feature as never }, options(fetch)))
        .rejects.toBeInstanceOf(TypeError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'Reports', `${'a'.repeat(129)}`, 'reports\n'])(
    'rejects an invalid feature before configuration: %j',
    async (feature) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      await expect(checkFeature({ feature }, { fetch }))
        .rejects.toBeInstanceOf(TypeError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('accepts a 128 character feature', async () => {
    const fetch = replying(() => json({ ...allowed, feature: 'a'.repeat(128) }));
    await expect(checkFeature({ feature: 'a'.repeat(128) }, options(fetch)))
      .resolves.toMatchObject({ feature: 'a'.repeat(128) });
  });

  it('rejects a bad feature before configuration or transport work', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(checkFeature({ feature: 'Reports!' }, { fetch }))
      .rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a secret key without making a request', async () => {
    vi.stubEnv('AUTHOWL_SECRET_KEY', '');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const error = await checkFeature(
      { feature: 'reports' },
      { apiUrl: API_URL, fetch },
    ).catch((value) => value);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain('billing:read');
    expect(error.message).not.toContain(SECRET_KEY);
    expect(error.cause).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never replaces an explicit empty secret key with the environment key', async () => {
    vi.stubEnv('AUTHOWL_SECRET_KEY', SECRET_KEY);
    const fetch = vi.fn<typeof globalThis.fetch>();
    const error = await checkFeature(
      { feature: 'reports' },
      { secretKey: '', apiUrl: API_URL, fetch },
    ).catch((value) => value);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain('billing:read');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps direct organization-required responses as TypeError', async () => {
    const fetch = replying(() => problem(400, 'INVALID_REQUEST'));
    await expect(checkFeature(
      { feature: 'reports', userId: USER_ID },
      options(fetch),
    )).rejects.toBeInstanceOf(TypeError);
  });

  it.each([
    [401, 'INVALID_SECRET_KEY'],
    [401, 'SECRET_KEY_REQUIRED'],
  ])('maps %s %s to a scoped configuration error', async (status, code) => {
    const fetch = replying(() => problem(status, code));
    const error = await checkFeature({ feature: 'reports' }, options(fetch)).catch((value) => value);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain(code);
    expect(error.message).toContain('billing:read');
    expect(error.message).not.toContain(SECRET_KEY);
  });

  it('maps insufficient scope to key replacement guidance', async () => {
    const fetch = replying(() => problem(403, 'INSUFFICIENT_SCOPE'));
    const error = await checkFeature({ feature: 'reports' }, options(fetch))
      .catch((value) => value);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain('billing:read');
    expect(error.message).toContain('create a new secret key');
    expect(error.message).not.toContain(SECRET_KEY);
  });

  it('maps a non-scope 403 to a TypeError naming its code', async () => {
    const fetch = replying(() => problem(403, 'FORBIDDEN'));
    const error = await checkFeature({ feature: 'reports' }, options(fetch))
      .catch((value) => value);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain('FORBIDDEN');
    expect(error.message).not.toContain('create a new secret key');
  });

  it('maps other bad requests to a TypeError naming the code', async () => {
    const fetch = replying(() => problem(400, 'INVALID_REQUEST'));
    await expect(checkFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toThrow('INVALID_REQUEST');
  });

  it.each([503, 429, 404, 500])('maps status %s to billing unavailable', async (status) => {
    const fetch = replying(() => problem(status, 'BILLING_UNAVAILABLE'));
    await expect(checkFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toBeInstanceOf(BillingUnavailableError);
  });

  it('keeps the fixed unavailable error contract and its cause', async () => {
    const fetch = replying(() => problem(503, 'BILLING_UNAVAILABLE'));
    const error = await checkFeature({ feature: 'reports' }, options(fetch))
      .catch((value) => value);
    expect(error).toBeInstanceOf(BillingUnavailableError);
    expect(error).toMatchObject({
      name: 'BillingUnavailableError',
      message: 'Billing is unavailable. No feature was granted.',
    });
    expect(error.cause).toMatchObject({ status: 503, code: 'BILLING_UNAVAILABLE' });
  });

  it('maps a network failure to billing unavailable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('offline');
    });
    await expect(checkFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toBeInstanceOf(BillingUnavailableError);
  });

  it('maps a 200 body that fails the response schema to billing unavailable', async () => {
    const fetch = replying(() => json({ feature: 1 }));
    await expect(checkFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toBeInstanceOf(BillingUnavailableError);
  });

  it('times out even when the custom fetch ignores its abort signal', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
    const assertion = expect(checkFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toBeInstanceOf(BillingUnavailableError);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

describe('hasFeature', () => {
  it('returns false without a session and makes no request', async () => {
    authMock.mockResolvedValue(null);
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(hasFeature({ feature: 'reports' }, options(fetch))).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns false for an AuthServiceError and makes no request', async () => {
    authMock.mockRejectedValue(new AuthServiceError('session unavailable'));
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(hasFeature({ feature: 'reports' }, options(fetch))).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates an auth configuration error without making a request', async () => {
    const configuration = new Error('AuthOwl is not configured');
    authMock.mockRejectedValue(configuration);
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(hasFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toBe(configuration);
    await expect(requireFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toBe(configuration);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [true, true],
    [false, false],
  ])('returns %s when allowed is %s', async (expected, decision) => {
    signedIn();
    const fetch = replying(() => json({
      ...allowed,
      allowed: decision,
      reason: decision ? null : 'not_granted',
    }));
    await expect(hasFeature({ feature: 'reports' }, options(fetch))).resolves.toBe(expected);
    expect(sentBody(fetch)).toEqual({
      feature: 'reports', userId: USER_ID, organizationId: ORG_ID,
    });
  });

  it('omits a null organization and maps organization-required to false', async () => {
    signedIn(null);
    const fetch = replying(() => problem(400, 'INVALID_REQUEST'));
    await expect(hasFeature({ feature: 'reports' }, options(fetch))).resolves.toBe(false);
    expect(sentBody(fetch)).toEqual({
      feature: 'reports', userId: USER_ID,
    });
  });

  it.each([
    [ORG_ID, 'INVALID_REQUEST'],
    [null, 'VALIDATION_FAILED'],
  ] as const)('does not map a 400 for organization %s and code %s', async (organizationId, code) => {
    signedIn(organizationId);
    const hasFetch = replying(() => problem(400, code));
    await expect(hasFeature({ feature: 'reports' }, options(hasFetch)))
      .rejects.toBeInstanceOf(TypeError);

    signedIn(organizationId);
    const requireFetch = replying(() => problem(400, code));
    await expect(requireFeature({ feature: 'reports' }, options(requireFetch)))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('validates a helper feature before reading the session', async () => {
    authMock.mockResolvedValue(null);
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(hasFeature({ feature: undefined as never }, options(fetch)))
      .rejects.toBeInstanceOf(TypeError);
    await expect(requireFeature({ feature: undefined as never }, options(fetch)))
      .rejects.toBeInstanceOf(TypeError);
    expect(authMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on an outage but propagates configuration errors', async () => {
    signedIn();
    const outage = replying(() => problem(503, 'BILLING_UNAVAILABLE'));
    await expect(hasFeature({ feature: 'reports' }, options(outage))).resolves.toBe(false);
    const badKey = replying(() => problem(401, 'INVALID_SECRET_KEY'));
    await expect(hasFeature({ feature: 'reports' }, options(badKey))).rejects.toThrow(TypeError);
  });
});

describe('requireFeature', () => {
  it('throws the standard unauthenticated authorization error', async () => {
    authMock.mockResolvedValue(null);
    const error = await requireFeature({ feature: 'reports' }, options(vi.fn()))
      .catch((value) => value);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error).toMatchObject({ status: 401, reason: 'unauthenticated' });
  });

  it.each([
    ['no_customer', 'no_customer'],
    ['not_granted', 'not_granted'],
  ] as const)('preserves the %s denial', async (reason, denial) => {
    signedIn();
    const fetch = replying(() => json({
      ...allowed, allowed: false, reason,
    }));
    const error = await requireFeature({ feature: 'reports' }, options(fetch))
      .catch((value) => value);
    expect(error).toBeInstanceOf(FeatureDeniedError);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error).toMatchObject({
      status: 403,
      reason: 'forbidden',
      feature: 'reports',
      denial,
      name: 'AuthorizationError',
    });
    expect(isAuthorizationError(error)).toBe(true);
  });

  it('maps an organization-required response to no_organization', async () => {
    signedIn(null);
    const fetch = replying(() => problem(400, 'INVALID_REQUEST'));
    await expect(requireFeature({ feature: 'reports' }, options(fetch)))
      .rejects.toMatchObject({ denial: 'no_organization', status: 403 });
  });

  it('returns an allowed check', async () => {
    signedIn();
    const fetch = replying(() => json(allowed));
    await expect(requireFeature({ feature: 'reports' }, options(fetch)))
      .resolves.toMatchObject({ allowed: true, feature: 'reports' });
  });

  it('rethrows an outage, insufficient scope, and AuthServiceError', async () => {
    signedIn();
    const outage = replying(() => problem(503, 'BILLING_UNAVAILABLE'));
    await expect(requireFeature({ feature: 'reports' }, options(outage)))
      .rejects.toBeInstanceOf(BillingUnavailableError);

    signedIn();
    const scope = replying(() => problem(403, 'INSUFFICIENT_SCOPE'));
    await expect(requireFeature({ feature: 'reports' }, options(scope)))
      .rejects.toBeInstanceOf(TypeError);

    const serviceError = new AuthServiceError('session unavailable');
    authMock.mockRejectedValue(serviceError);
    await expect(requireFeature({ feature: 'reports' }, options(vi.fn())))
      .rejects.toBe(serviceError);
  });
});
