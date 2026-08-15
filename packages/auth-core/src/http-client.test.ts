import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import { createAuthHttpClient } from './http-client';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';

function httpWith(fetchImpl: typeof fetch) {
  return createAuthHttpClient(
    resolveConfig({ publishableKey: PK, apiUrl: 'https://auth.example.com', fetch: fetchImpl }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthOwl HTTP client', () => {
  it('sends credentials/key/body, runs lifecycle hooks, and revives dates', async () => {
    const order: string[] = [];
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ createdAt: '2026-07-13T00:00:00.000Z', value: 'ok' }),
    );
    const fetchImpl = fetchSpy as unknown as typeof fetch;

    const result = await httpWith(fetchImpl).request<{ createdAt: Date; value: string }>('/example', {
      method: 'POST',
      body: { hello: 'world' },
      query: { fresh: true },
      fetchOptions: {
        headers: { 'x-extra': 'yes' },
        onRequest: () => order.push('request'),
        onResponse: () => order.push('response'),
        onSuccess: () => order.push('success'),
      },
    });

    expect(result.error).toBeNull();
    expect(result.data?.createdAt).toBeInstanceOf(Date);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/auth/example?fresh=true');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('x-publishable-key')).toBe(PK);
    expect(new Headers(init?.headers).get('x-extra')).toBe('yes');
    expect(JSON.parse(String(init?.body))).toEqual({ hello: 'world' });
    expect(order).toEqual(['request', 'response', 'success']);
  });

  it('exposes only frozen, secret-free lifecycle contexts', async () => {
    const password = 'correct horse battery staple';
    const challenge = 'turnstile-single-use-secret';
    const queryValue = 'private-filter-value';
    const contexts: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { ok: true },
        { headers: { 'x-request-id': 'request-safe-123' } },
      ),
    );

    const result = await httpWith(fetchImpl).request('/sign-in/email', {
      method: 'POST',
      query: { filter: queryValue },
      body: { email: 'mona@example.com', password },
      fetchOptions: {
        authChallengeToken: challenge,
        headers: { authorization: 'Bearer caller-secret' },
        onRequest: (context) => contexts.push(context),
        onResponse: (context) => contexts.push(context),
        onSuccess: (context) => contexts.push(context),
      },
    });

    expect(result.error).toBeNull();
    expect(contexts).toHaveLength(3);
    expect(contexts.every(Object.isFrozen)).toBe(true);
    expect(contexts[0]).toEqual({ method: 'POST', path: '/sign-in/email' });
    expect(contexts[1]).toMatchObject({
      method: 'POST',
      path: '/sign-in/email',
      status: 200,
      requestId: 'request-safe-123',
    });
    const serialized = JSON.stringify(contexts);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(challenge);
    expect(serialized).not.toContain(queryValue);
    expect(serialized).not.toContain('caller-secret');
    expect(serialized).not.toContain(PK);
  });

  it('removes durable session tokens at the browser response boundary', async () => {
    const payloads = new Map<string, unknown>([
      ['/get-session', {
        session: { id: 'session-current', token: 'durable-current' },
        user: { id: 'user-1' },
      }],
      ['/list-sessions', [
        { id: 'session-current', token: 'durable-current' },
        { id: 'session-other', token: 'durable-other' },
      ]],
      ['/sign-up/email', { token: 'durable-signup', user: { id: 'user-1' } }],
      ['/phone-otp/verify', {
        status: true,
        token: 'durable-phone',
        user: { id: 'user-1' },
      }],
      ['/passkey/verify-authentication', {
        token: 'durable-passkey-top-level',
        session: { id: 'session-current', token: 'durable-passkey-session' },
        user: { id: 'user-1' },
      }],
      ['/two-factor/verify-otp', {
        token: 'durable-mfa',
        user: { id: 'user-1' },
      }],
      ['/change-password', {
        token: 'durable-password-change',
        user: { id: 'user-1' },
      }],
      // This endpoint intentionally returns a separate short-lived backend JWT.
      ['/token', { token: 'short-lived-backend-jwt' }],
    ]);
    const observedByHook: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname.replace(
        '/api/projects/11111111-1111-1111-1111-111111111111/auth',
        '',
      );
      return Response.json(payloads.get(path));
    }) as unknown as typeof fetch;
    const http = httpWith(fetchImpl);

    for (const path of payloads.keys()) {
      const result = await http.request<Record<string, unknown>>(path, {
        fetchOptions: {
          onResponse: (context) => {
            observedByHook.push(context);
          },
        },
      });
      expect(result.error).toBeNull();
      if (path === '/token') {
        expect(result.data).toEqual({ token: 'short-lived-backend-jwt' });
      } else {
        expect(JSON.stringify(result.data)).not.toContain('durable-');
      }
      if (path === '/phone-otp/verify') {
        expect(result.data).not.toHaveProperty('sessionCreated');
      }
    }

    expect(JSON.stringify(observedByHook)).not.toContain('durable-');
    expect(JSON.stringify(observedByHook)).not.toContain('short-lived-backend-jwt');

    const pendingSignup = await httpWith(
      vi.fn(async () =>
        Response.json({ token: null, user: { id: 'pending-user' } }),
      ) as unknown as typeof fetch,
    ).request<Record<string, unknown>>('/sign-up/email');
    expect(pendingSignup.data).toEqual({
      sessionCreated: false,
      user: { id: 'pending-user' },
    });
  });

  it('never exposes token, TOTP, or backup-code response data to hooks', async () => {
    const payloads = new Map<string, unknown>([
      ['/token', { token: 'short-lived-backend-jwt' }],
      ['/two-factor/enable', {
        totpURI: 'otpauth://totp/AuthOwl?secret=TOTPSECRET',
        backupCodes: ['backup-code-one'],
      }],
      ['/two-factor/generate-backup-codes', {
        backupCodes: ['replacement-backup-code'],
      }],
    ]);
    const contexts: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname.replace(
        '/api/projects/11111111-1111-1111-1111-111111111111/auth',
        '',
      );
      return Response.json(payloads.get(path));
    });
    const http = httpWith(fetchImpl);

    for (const path of payloads.keys()) {
      const result = await http.request(path, {
        method: path === '/token' ? 'GET' : 'POST',
        body: path === '/token' ? undefined : {},
        fetchOptions: {
          onResponse: (context) => contexts.push(context),
          onSuccess: (context) => contexts.push(context),
        },
      });
      expect(result.error).toBeNull();
    }

    const serialized = JSON.stringify(contexts);
    expect(serialized).not.toContain('short-lived-backend-jwt');
    expect(serialized).not.toContain('TOTPSECRET');
    expect(serialized).not.toContain('backup-code-one');
    expect(serialized).not.toContain('replacement-backup-code');
    expect(contexts).toHaveLength(6);
  });

  it('normalizes typed server errors and invokes onError', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: 'RATE_LIMITED', message: 'Slow down.' }, { status: 429 }),
    ) as unknown as typeof fetch;
    const result = await httpWith(fetchImpl).request('/example', {
      fetchOptions: { onError },
    });
    expect(result).toEqual({
      data: null,
      error: {
        status: 429,
        statusText: '',
        code: 'RATE_LIMITED',
        message: 'Slow down.',
      },
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('keeps reflected API secrets out of lifecycle error contexts', async () => {
    const password = 'reflected-password-secret';
    const token = 'reflected-reset-token';
    const contexts: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: `INVALID_${token}`,
          detail: `Password ${password} was rejected.`,
        },
        {
          status: 400,
          headers: { 'x-request-id': 'safe-error-request' },
        },
      ),
    );

    const result = await httpWith(fetchImpl).request('/reset-password', {
      method: 'POST',
      body: { password, token },
      fetchOptions: {
        onError: (context) => contexts.push(context),
      },
    });

    expect(result.error?.message).toContain(password);
    expect(contexts).toEqual([{
      method: 'POST',
      path: '/reset-password',
      status: 400,
      requestId: 'safe-error-request',
      failure: 'api',
    }]);
    expect(JSON.stringify(contexts)).not.toContain(password);
    expect(JSON.stringify(contexts)).not.toContain(token);
  });

  it('parses retryAfterSeconds from the body, then headers, and clamps', async () => {
    // Body field wins over any header.
    const bodyImpl = vi.fn(async () =>
      Response.json(
        { code: 'RATE_LIMITED', message: 'Slow down.', retryAfterSeconds: 300 },
        { status: 429, headers: { 'retry-after': '999' } },
      ),
    ) as unknown as typeof fetch;
    expect((await httpWith(bodyImpl).request('/x')).error?.retryAfterSeconds).toBe(300);

    // Retry-After header used when the body has no field.
    const headerImpl = vi.fn(async () =>
      Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { 'retry-after': '45' } }),
    ) as unknown as typeof fetch;
    expect((await httpWith(headerImpl).request('/x')).error?.retryAfterSeconds).toBe(45);

    // X-Retry-After is the last-resort source (the fork's per-IP limiter uses it).
    const xImpl = vi.fn(async () =>
      Response.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429, headers: { 'x-retry-after': '12' } }),
    ) as unknown as typeof fetch;
    expect((await httpWith(xImpl).request('/x')).error?.retryAfterSeconds).toBe(12);

    // HTTP-date Retry-After form is ignored (delta-seconds only).
    const dateImpl = vi.fn(async () =>
      Response.json(
        { code: 'RATE_LIMITED' },
        { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } },
      ),
    ) as unknown as typeof fetch;
    expect((await httpWith(dateImpl).request('/x')).error?.retryAfterSeconds).toBeUndefined();

    // Clamp: above 24h -> 86400, at or below zero -> 1.
    const highImpl = vi.fn(async () =>
      Response.json({ code: 'RATE_LIMITED', retryAfterSeconds: 999999 }, { status: 429 }),
    ) as unknown as typeof fetch;
    expect((await httpWith(highImpl).request('/x')).error?.retryAfterSeconds).toBe(86400);
    const lowImpl = vi.fn(async () =>
      Response.json({ code: 'RATE_LIMITED', retryAfterSeconds: 0 }, { status: 429 }),
    ) as unknown as typeof fetch;
    expect((await httpWith(lowImpl).request('/x')).error?.retryAfterSeconds).toBe(1);

    // No source -> the field is absent (not present-as-undefined).
    const noneImpl = vi.fn(async () =>
      Response.json({ code: 'RATE_LIMITED' }, { status: 429 }),
    ) as unknown as typeof fetch;
    const none = await httpWith(noneImpl).request('/x');
    expect('retryAfterSeconds' in (none.error ?? {})).toBe(false);
  });

  it('preserves RFC problem details and the live metadata version', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          code: 'VERSION_CONFLICT',
          detail: 'Metadata changed since it was read.',
          current_version: 7,
        },
        { status: 409, statusText: 'Conflict' },
      ),
    ) as unknown as typeof fetch;

    const result = await httpWith(fetchImpl).request('/user/metadata');

    expect(result.error).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      currentVersion: 7,
      message: 'Metadata changed since it was read.',
    });
  });

  it('retries GET 5xx responses only when requested', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const result = await httpWith(fetchImpl as unknown as typeof fetch).request('/example', {
      fetchOptions: { retry: 1 },
    });
    expect(result.data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries an opted-in GET network failure without exposing its message', async () => {
    const secret = 'sk_test_fetch-error-secret';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(`socket failed with ${secret}`))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const result = await httpWith(fetchImpl).request('/example', {
      fetchOptions: { retry: 1 },
    });

    expect(result).toEqual({ data: { ok: true }, error: null });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(['POST', 'PATCH'] as const)(
    'never replays a %s mutation after an ambiguous failure',
    async (method) => {
      const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(
        new Error('the mutation may already have committed'),
      );
      const result = await httpWith(fetchImpl).request('/mutation', {
        method,
        body: { value: 'once' },
        fetchOptions: { retry: 3 },
      });

      expect(result.error?.code).toBe('FETCH_ERROR');
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it('does not retry a challenged GET or a rate-limited response', async () => {
    const challenged = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'));
    await httpWith(challenged).request('/challenge', {
      fetchOptions: { authChallengeToken: 'single-use', retry: 3 },
    });
    expect(challenged).toHaveBeenCalledOnce();

    const limited = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ code: 'RATE_LIMITED' }, { status: 429 }),
    );
    await httpWith(limited).request('/limited', {
      fetchOptions: { retry: 3 },
    });
    expect(limited).toHaveBeenCalledOnce();
  });

  it('normalizes timeout, invalid media type, oversize, and request ID failures', async () => {
    vi.useFakeTimers();
    const stalled = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const timeoutRequest = httpWith(stalled).request('/stalled');
    const timeoutResult = timeoutRequest.then((result) => result);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(timeoutResult).resolves.toMatchObject({
      data: null,
      error: { code: 'REQUEST_TIMEOUT', statusText: 'TIMEOUT' },
    });
    vi.useRealTimers();

    const html = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(httpWith(html).request('/html')).resolves.toMatchObject({
      error: { code: 'INVALID_RESPONSE' },
    });

    const oversize = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', {
        headers: {
          'content-length': String(1024 * 1024 + 1),
          'content-type': 'application/json',
          'x-request-id': 'oversize-request',
        },
      }),
    );
    await expect(httpWith(oversize).request('/oversize')).resolves.toMatchObject({
      error: {
        code: 'RESPONSE_TOO_LARGE',
        requestId: 'oversize-request',
      },
    });
  });

  it('keeps JSON metadata date-like strings as JSON strings', async () => {
    const date = '2026-07-13T00:00:00.000Z';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        public_metadata: { nested: { createdAt: date } },
        unsafe_metadata: { updatedAt: date },
        metadata_version: 1,
      }),
    );
    const result = await httpWith(fetchImpl).request<{
      public_metadata: { nested: { createdAt: string } };
      unsafe_metadata: { updatedAt: string };
    }>('/user/metadata');

    expect(result.data?.public_metadata.nested.createdAt).toBe(date);
    expect(result.data?.unsafe_metadata.updatedAt).toBe(date);
  });

  it('rejects deeply nested success JSON before lifecycle hooks run', async () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let depth = 0; depth < 40; depth += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    const onResponse = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(deep));

    const result = await httpWith(fetchImpl).request('/deep', {
      fetchOptions: { onResponse, onSuccess, onError },
    });

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(onResponse).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('normalizes cancellation without retrying', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    const result = await httpWith(fetchImpl).request('/example', {
      fetchOptions: { signal: controller.signal, retry: 3 },
    });
    expect(result.error?.code).toBe('REQUEST_ABORTED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
