import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  AuthOwlAdminApiError,
  AuthOwlAdminNetworkError,
  createAdminClient,
  type AdminClient,
  type AdminOperationResult,
} from './admin-client';
import { adminOperations } from './admin-operations.generated';

const SECRET_KEY = ['sk', 'test', '00000000-0000-4000-8000-000000000001', 'A'.repeat(32)].join('_');

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

function createFetch(response: Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

function userResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    email: 'mona@example.com',
    phone: null,
    name: 'Mona',
    image: null,
    email_verified: false,
    banned: false,
    public_metadata: {},
    private_metadata: {},
    unsafe_metadata: {},
    metadata_version: 0,
    created_at: '2026-07-30T09:00:00.000Z',
    updated_at: '2026-07-30T09:00:00.000Z',
    ...overrides,
  };
}

function messageResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    state: 'queued',
    purpose: 'transactional',
    requested_channel: 'auto',
    actual_channel: null,
    customer_reference: 'order-42',
    masked_recipient: '+20*******890',
    sms: null,
    billing: {
      credential_mode: 'byok',
      unit: null,
      units: null,
      charged_piasters: 0,
      reserved_piasters: 0,
    },
    failure: null,
    created_at: '2026-08-02T09:00:00.000Z',
    updated_at: '2026-08-02T09:00:00.000Z',
    delivered_at: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createAdminClient', () => {
  it('rejects a successful payload that violates the generated response schema', async () => {
    const invalid = userResponse();
    delete invalid.id;
    const fetchMock = createFetch(jsonResponse(invalid, { status: 201 }));
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'https://auth.example.com',
      fetch: fetchMock,
    });

    await expect(
      admin.createUser({ body: { email: 'mona@example.com', name: 'Mona' } }),
    ).rejects.toMatchObject({
      name: 'AuthOwlAdminNetworkError',
      kind: 'invalid_response',
    });
  });

  it('rejects a declared response larger than the Admin API bound', async () => {
    const fetchMock = createFetch(new Response('{}', {
      headers: {
        'content-length': String(2 * 1024 * 1024),
        'content-type': 'application/json',
      },
    }));
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'https://auth.example.com',
      fetch: fetchMock,
    });

    await expect(admin.listUsers()).rejects.toMatchObject({
      name: 'AuthOwlAdminNetworkError',
      kind: 'response_too_large',
    });
  });

  it('times out even when a custom fetch ignores its abort signal', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'https://auth.example.com',
      fetch: fetchMock,
    });
    const request = admin.listUsers();
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AuthOwlAdminNetworkError',
      kind: 'timeout',
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it('calls the versioned API with bearer auth and typed query parameters', async () => {
    const responseBody = { data: [], next_cursor: null };
    const fetchMock = createFetch(jsonResponse(responseBody));
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'http://localhost:3010',
      fetch: fetchMock,
    });

    const result = await admin.listUsers({ query: { limit: 25, cursor: 'next value', query: 'Mona' } });

    expect(result).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      'http://localhost:3010/api/v1/users?limit=25&cursor=next+value&query=Mona',
    );
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
  });

  it('serializes request bodies without putting the secret in the URL', async () => {
    const responseBody = userResponse();
    const fetchMock = createFetch(jsonResponse(responseBody, { status: 201 }));
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'https://auth.example.com/api/v1/',
      fetch: fetchMock,
    });

    await admin.createUser({ body: { email: 'mona@example.com', name: 'Mona' } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://auth.example.com/api/v1/users');
    expect(String(url)).not.toContain(SECRET_KEY);
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ email: 'mona@example.com', name: 'Mona' }));
  });

  it('sends messages with a typed idempotency header owned by the operation', async () => {
    const responseBody = messageResponse();
    const fetchMock = createFetch(jsonResponse(responseBody, { status: 202 }));
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'https://auth.example.com',
      fetch: fetchMock,
    });

    const result = await admin.sendMessage({
      header: { 'Idempotency-Key': 'order-42-shipped' },
      body: {
        to: '+201001234567',
        channel: 'auto',
        purpose: 'transactional',
        template: 'order_shipped',
        locale: 'ar',
        variables: { orderNumber: '42' },
        customerReference: 'order-42',
      },
    });

    expect(result).toEqual(responseBody);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://auth.example.com/api/v1/messages');
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe('order-42-shipped');
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET_KEY}`);
  });

  it.each(['', 'x'.repeat(256), 'line\nbreak'])(
    'rejects an unsafe messaging idempotency key before fetch: %j',
    async (idempotencyKey) => {
      const fetchMock = createFetch(jsonResponse(messageResponse(), { status: 202 }));
      const admin = createAdminClient({
        secretKey: SECRET_KEY,
        apiUrl: 'https://auth.example.com',
        fetch: fetchMock,
      });

      await expect(admin.sendMessage({
        header: { 'Idempotency-Key': idempotencyKey },
        body: {
          to: '+201001234567',
          template: 'order_shipped',
          variables: {},
        },
      })).rejects.toThrow('Idempotency-Key');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('encodes path parameters and returns undefined for a documented 204', async () => {
    const fetchMock = createFetch(new Response(null, { status: 204 }));
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'http://127.0.0.1:3010',
      fetch: fetchMock,
    });

    const result = await admin.deleteUser({ path: { userId: 'user/with spaces' } });

    expect(result).toBeUndefined();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://127.0.0.1:3010/api/v1/users/user%2Fwith%20spaces',
    );
  });

  it('exposes structured problem details, request ID, and retry delay', async () => {
    const problem = {
      type: 'https://docs.authowl.dev/errors/rate-limited',
      title: 'Rate limit exceeded',
      status: 429,
      detail: 'Try again later.',
      instance: 'urn:authowl:request:req-123',
      code: 'RATE_LIMITED',
    };
    const fetchMock = createFetch(
      jsonResponse(problem, {
        status: 429,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '12', 'x-request-id': 'req-123' },
      }),
    );
    const admin = createAdminClient({ secretKey: SECRET_KEY, apiUrl: 'https://auth.example.com', fetch: fetchMock });

    const error = await admin.listUsers().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthOwlAdminApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      requestId: 'req-123',
      retryAfter: '12',
      problem,
      message: 'Try again later.',
    });
    expect(JSON.stringify(error)).not.toContain(SECRET_KEY);
  });

  it('uses a stable fallback for non-JSON API errors', async () => {
    const fetchMock = createFetch(new Response('upstream error', { status: 502 }));
    const admin = createAdminClient({ secretKey: SECRET_KEY, apiUrl: 'https://auth.example.com', fetch: fetchMock });

    await expect(admin.listUsers()).rejects.toMatchObject({
      name: 'AuthOwlAdminApiError',
      status: 502,
      code: 'UNKNOWN_ERROR',
    });
  });

  it('wraps transport failures without retaining their message or the key', async () => {
    const cause = new Error(`failed while using ${SECRET_KEY}`);
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(cause);
    const admin = createAdminClient({ secretKey: SECRET_KEY, apiUrl: 'https://auth.example.com', fetch: fetchMock });

    const error = await admin.listUsers().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthOwlAdminNetworkError);
    expect((error as Error).message).not.toContain(SECRET_KEY);
    expect(error).toMatchObject({ kind: 'network' });
    expect(JSON.stringify(error)).not.toContain(SECRET_KEY);
  });

  it('classifies aborts without retaining the underlying error', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const admin = createAdminClient({ secretKey: SECRET_KEY, apiUrl: 'https://auth.example.com', fetch: fetchMock });
    const request = admin.listUsers({ signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({
      name: 'AuthOwlAdminNetworkError',
      kind: 'aborted',
    });
  });

  it('classifies malformed success payloads as invalid responses', async () => {
    const fetchMock = createFetch(
      new Response('not JSON', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const admin = createAdminClient({ secretKey: SECRET_KEY, apiUrl: 'https://auth.example.com', fetch: fetchMock });

    await expect(admin.listUsers()).rejects.toMatchObject({
      name: 'AuthOwlAdminNetworkError',
      kind: 'invalid_response',
    });
  });

  it.each([
    ['publishable key', ['pk', 'test', '00000000-0000-4000-8000-000000000001', 'A'.repeat(32)].join('_'), 'https://auth.example.com'],
    ['insecure remote URL', SECRET_KEY, 'http://auth.example.com'],
    ['URL credentials', SECRET_KEY, 'https://admin:password@auth.example.com'],
    ['unexpected base path', SECRET_KEY, 'https://auth.example.com/custom'],
  ])('rejects invalid configuration: %s', (_case, secretKey, apiUrl) => {
    expect(() => createAdminClient({ secretKey, apiUrl })).toThrow();
  });

  it('refuses to construct the secret-key client in a browser document', () => {
    vi.stubGlobal('window', { document: {} });
    try {
      expect(() =>
        createAdminClient({ secretKey: SECRET_KEY, apiUrl: 'https://auth.example.com' }),
      ).toThrow('must not be called in a browser');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('exposes every generated operation plus the typed request method', () => {
    const admin = createAdminClient({
      secretKey: SECRET_KEY,
      apiUrl: 'https://auth.example.com',
      fetch: createFetch(jsonResponse({})),
    });

    expect(Object.keys(admin).sort()).toEqual([...Object.keys(adminOperations), 'request'].sort());
    expect(Object.isFrozen(admin)).toBe(true);
  });

  it('keeps operation inputs and results contract-typed', () => {
    expectTypeOf<AdminOperationResult<'listUsers'>>().toMatchTypeOf<{
      readonly data: readonly unknown[];
      readonly next_cursor: string | null;
    }>();

    const assertOperationInputs = (admin: AdminClient) => {
      void admin.getUser({ path: { userId: 'user-1' } });
      void admin.updateUserMetadata({
        path: { userId: 'user-1' },
        body: { expected_version: 0, public_metadata: { locale: 'ar' } },
      });
      void admin.getSession({ path: { sessionId: 'session-1' } });
      void admin.updateSessionMetadata({
        path: { sessionId: 'session-1' },
        body: { expected_version: 0, metadata: { checkout: 'review' } },
      });
      void admin.listUsers({ query: { limit: 10 } });
      void admin.sendMessage({
        header: { 'Idempotency-Key': 'order-42' },
        body: {
          to: '+201001234567',
          template: 'order_shipped',
          variables: { orderNumber: '42' },
        },
      });
      // @ts-expect-error getUser requires its generated path parameters.
      void admin.getUser();
      // @ts-expect-error listUsers has no request body.
      void admin.listUsers({ body: {} });
      // @ts-expect-error sendMessage requires an explicit idempotency header.
      void admin.sendMessage({ body: { to: '+201001234567', template: 'x', variables: {} } });
    };
    void assertOperationInputs;
  });
});
