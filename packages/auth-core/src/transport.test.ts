import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestBoundedJson, withoutSessionTransport, TransportError } from './transport';

afterEach(() => {
  vi.useRealTimers();
});

describe('requestBoundedJson', () => {
  it('will not execute a fetch that skipped the transport wiring', () => {
    // Never invoked: the assertion is the COMPILE error. `@ts-expect-error`
    // fails typecheck the moment `fetchImpl` accepts a bare `fetch` again, which
    // is the shape that let one client get the session transport and its sibling
    // silently go without.
    const call = () =>
      requestBoundedJson({
        // @ts-expect-error - a bare `fetch` is not a TransportFetch.
        fetchImpl: globalThis.fetch,
        url: 'https://example.test/',
      });

    expect(typeof call).toBe('function');
  });

  it('refuses redirects and parses bounded JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ok: true }, { headers: { 'x-request-id': 'req_123' } }),
    );

    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
      init: { redirect: 'follow' },
    })).resolves.toMatchObject({
      data: { ok: true },
      requestId: 'req_123',
    });

    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe('error');
  });

  it('does not forward sensitive headers across a real redirect', async () => {
    let targetRequests = 0;
    const target = createServer((_request, response) => {
      targetRequests += 1;
      response.setHeader('content-type', 'application/json');
      response.end('{"captured":true}');
    });
    const targetPort = await listen(target);
    const origin = createServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader('location', `http://127.0.0.1:${targetPort}/capture`);
      response.end();
    });
    const originPort = await listen(origin);
    const secret = 'sk_test_redirect-secret';

    try {
      const error = await requestBoundedJson({
        fetchImpl: withoutSessionTransport(fetch),
        url: `http://127.0.0.1:${originPort}/start`,
        allowHttpLoopback: true,
        init: {
          headers: {
            authorization: `Bearer ${secret}`,
            cookie: 'session=durable-secret',
          },
        },
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ name: 'TransportError', kind: 'network' });
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(targetRequests).toBe(0);
    } finally {
      await Promise.all([close(origin), close(target)]);
    }
  });

  it('accepts structured JSON media types and bodyless success statuses', async () => {
    const problemJson = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/problem+json; charset=utf-8' },
      }),
    );
    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(problemJson),
      url: 'https://auth.example.com/example',
    })).resolves.toMatchObject({ data: { ok: true } });

    const noContent = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(noContent),
      url: 'https://auth.example.com/example',
    })).resolves.toMatchObject({ data: null });
  });

  it('accepts a structurally valid response from a custom Response class', async () => {
    const native = Response.json({ ok: true });
    const crossRealmLikeResponse = {
      status: native.status,
      statusText: native.statusText,
      ok: native.ok,
      headers: native.headers,
      body: native.body,
    } as Response;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(crossRealmLikeResponse);

    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
    })).resolves.toMatchObject({ data: { ok: true } });
  });

  it('times out even when a custom fetch ignores the abort signal', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const request = requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
      timeoutMs: 50,
    });
    const assertion = expect(request).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'timeout',
    });

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('times out while a response body stalls', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel,
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, { headers: { 'content-type': 'application/json' } }),
    );
    const request = requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
      timeoutMs: 50,
    });
    const assertion = expect(request).rejects.toMatchObject({ kind: 'timeout' });

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('classifies a native fetch body timeout as timeout, not network', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"partial":');
    });
    const port = await listen(server);

    try {
      await expect(requestBoundedJson({
        fetchImpl: withoutSessionTransport(fetch),
        url: `http://127.0.0.1:${port}/stalled`,
        allowHttpLoopback: true,
        timeoutMs: 100,
      })).rejects.toMatchObject({ kind: 'timeout' });
    } finally {
      await close(server);
    }
  });

  it('distinguishes caller cancellation from timeout', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const request = requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
      init: { signal: controller.signal },
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('does not invoke fetch when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
      init: { signal: controller.signal },
    })).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires HTTPS unless exact loopback is explicitly approved', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));

    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'http://auth.example.com/example',
    })).rejects.toThrow('must use HTTPS');
    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'http://localhost:3010/example',
      allowHttpLoopback: true,
    })).resolves.toMatchObject({ data: { ok: true } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects declared and streamed responses over the byte limit', async () => {
    const declared = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('ignored', {
        headers: {
          'content-length': '11',
          'content-type': 'application/json',
          'x-request-id': 'req-too-large',
        },
      }),
    );
    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(declared),
      url: 'https://auth.example.com/example',
      maxResponseBytes: 10,
    })).rejects.toMatchObject({
      kind: 'response_too_large',
      requestId: 'req-too-large',
    });

    const streamed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":"'));
          controller.enqueue(new TextEncoder().encode('too long"}'));
          controller.close();
        },
      }), { headers: { 'content-type': 'application/json' } }),
    );
    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(streamed),
      url: 'https://auth.example.com/example',
      maxResponseBytes: 10,
    })).rejects.toMatchObject({ kind: 'response_too_large' });
  });

  it.each([
    ['missing content type', new Response('{}')],
    [
      'HTML content type',
      new Response('{}', { headers: { 'content-type': 'text/html' } }),
    ],
    [
      'malformed JSON',
      new Response('{', { headers: { 'content-type': 'application/json' } }),
    ],
    [
      'invalid UTF-8',
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { 'content-type': 'application/json' },
      }),
    ],
  ])('rejects an invalid successful response: %s', async (_case, response) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
    })).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('does not retain hostile network error fields or invalid request IDs', async () => {
    const secret = 'sk_test_secret-material';
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(
      new TransportError('network', secret),
    );
    const error = await requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: `https://auth.example.com/${secret}`,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ kind: 'network', requestId: undefined });
    expect(JSON.stringify(error)).not.toContain(secret);

    const hostileBody = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream({
        pull(controller) {
          controller.error(new TransportError('network', secret));
        },
      }), {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'safe-request-id',
        },
      }),
    );
    const hostileBodyError = await requestBoundedJson({
      fetchImpl: withoutSessionTransport(hostileBody),
      url: 'https://auth.example.com/example',
    }).catch((caught: unknown) => caught);
    expect(hostileBodyError).toMatchObject({
      kind: 'network',
      requestId: 'safe-request-id',
    });
    expect(JSON.stringify(hostileBodyError)).not.toContain(secret);

    const invalidRequestId = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{', {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'bad request id',
        },
      }),
    );
    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(invalidRequestId),
      url: 'https://auth.example.com/example',
    })).rejects.toMatchObject({
      kind: 'invalid_response',
      requestId: undefined,
    });
  });

  it('keeps non-JSON error bodies opaque for endpoint-specific status handling', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>upstream</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );

    await expect(requestBoundedJson({
      fetchImpl: withoutSessionTransport(fetchImpl),
      url: 'https://auth.example.com/example',
    })).resolves.toMatchObject({
      response: { status: 502 },
      data: null,
    });
  });
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port.');
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
