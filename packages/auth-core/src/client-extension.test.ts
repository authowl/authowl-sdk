import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthOwlClient } from './client';
import {
  attachClientExtension,
  CLIENT_EXTENSION_KEY,
  clientExtension,
} from './client-extension';
import { resolveConfig } from './config';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const PUBLISHABLE_KEY = ['pk_test', PROJECT_ID, 'billingfixture000000'].join('_');

afterEach(() => {
  vi.restoreAllMocks();
});

function buildClient(fetchImpl: typeof fetch = vi.fn<typeof fetch>()) {
  return createAuthOwlClient(resolveConfig({
    publishableKey: PUBLISHABLE_KEY,
    apiUrl: 'https://auth.example.test',
    fetch: fetchImpl,
  }));
}

describe('client extension', () => {
  it('is hidden and immutable on clients created by core', () => {
    const client = buildClient();
    const keys = Object.keys(client);
    const json = JSON.stringify(client);
    const descriptor = Object.getOwnPropertyDescriptor(client, CLIENT_EXTENSION_KEY);

    expect(keys).not.toContain(String(CLIENT_EXTENSION_KEY));
    expect(json).not.toContain('client-extension');
    expect(descriptor).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: false,
    });
  });

  it('reads a client built by a separately evaluated module instance', async () => {
    const client = buildClient();
    vi.resetModules();
    const fresh = await import('./client-extension');

    expect(fresh.clientExtension(client).version).toBe(1);
  });

  it('uses the bound project URL, key, credentials and config transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }, {
      headers: { 'x-request-id': 'request-1' },
    }));
    const extension = clientExtension(buildClient(fetchImpl));
    const decoded = vi.fn((value: unknown) => value as { ok: boolean });

    const result = await extension.requestProjectJson('/billing/entitlements', {
      method: 'GET',
      timeoutMs: 1234,
      maxResponseBytes: 4321,
      decode: decoded,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://auth.example.test/api/projects/${PROJECT_ID}/billing/entitlements`,
    );
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('x-publishable-key')).toBe(PUBLISHABLE_KEY);
    expect(new Headers(init?.headers).get('accept')).toBe('application/json');
    expect(decoded).toHaveBeenCalledWith({ ok: true });
    expect(result).toEqual({
      ok: true,
      data: { ok: true },
    });
  });

  it('sets JSON headers and body for POST requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const extension = clientExtension(buildClient(fetchImpl));

    await extension.requestProjectJson('/billing/check', {
      method: 'POST',
      body: { feature: 'reports' },
      timeoutMs: 1000,
      maxResponseBytes: 1000,
      decode: (value: unknown) => value,
    });

    const init = fetchImpl.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe('{"feature":"reports"}');
  });

  it.each(['/auth', '/auth/x', '/', '/Billing', '/../x'])(
    'refuses the project path %s',
    async (path) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const extension = clientExtension(buildClient(fetchImpl));
      await expect(extension.requestProjectJson(path, {
        method: 'GET',
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        decode: (value) => value,
      })).rejects.toThrow(TypeError);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('refuses a method outside GET and POST at runtime', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const extension = clientExtension(buildClient(fetchImpl));
    await expect(extension.requestProjectJson('/billing/entitlements', {
      method: 'DELETE',
      timeoutMs: 1000,
      maxResponseBytes: 1000,
      decode: (value: unknown) => value,
    } as never)).rejects.toThrow('Project request method is invalid.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes timeout, byte cap and abort handling through the bounded transport', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    const extension = clientExtension(buildClient(fetchImpl));
    const request = extension.requestProjectJson('/billing/entitlements', {
      method: 'GET',
      timeoutMs: 25,
      maxResponseBytes: 7,
      decode: (value) => value,
    });
    const timedOut = expect(request).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(25);
    await timedOut;
    vi.useRealTimers();

    const oversizedFetch = vi.fn<typeof fetch>(async () => new Response('12345678', {
      headers: { 'content-type': 'application/json', 'content-length': '8' },
    }));
    await expect(clientExtension(buildClient(oversizedFetch)).requestProjectJson(
      '/billing/entitlements',
      {
        method: 'GET',
        timeoutMs: 1000,
        maxResponseBytes: 7,
        decode: (value) => value,
      },
    )).rejects.toMatchObject({ kind: 'response_too_large' });
  });

  it('maps bounded non-2xx metadata without exposing any other body field', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(
      { code: 'BILLING_UNAVAILABLE', secret: 'ignored' },
      { status: 503, headers: { 'retry-after': '9', 'x-request-id': 'request-2' } },
    ));

    await expect(clientExtension(buildClient(fetchImpl)).requestProjectJson(
      '/billing/entitlements',
      {
        method: 'GET',
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        decode: () => {
          throw new Error('must not decode an error body');
        },
      },
    )).resolves.toEqual({
      ok: false,
      status: 503,
      code: 'BILLING_UNAVAILABLE',
      retryAfterSeconds: 9,
      requestId: 'request-2',
    });
  });

  it('drops invalid or oversized failure metadata', async () => {
    const invalidFetch = vi.fn<typeof fetch>(async () => Response.json(
      { code: 'lowercase', secret: 'x' },
      { status: 400, headers: { 'x-request-id': 'request:invalid' } },
    ));
    await expect(clientExtension(buildClient(invalidFetch)).requestProjectJson(
      '/billing/entitlements',
      {
        method: 'GET', timeoutMs: 1000, maxResponseBytes: 5000, decode: (value) => value,
      },
    )).resolves.toEqual({
      ok: false, status: 400, code: null, requestId: null, retryAfterSeconds: null,
    });

    const oversizedFetch = vi.fn<typeof fetch>(async () => new Response(
      `${' '.repeat(4090)}{"code":"VALID_CODE"}`,
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    await expect(clientExtension(buildClient(oversizedFetch)).requestProjectJson(
      '/billing/entitlements',
      {
        method: 'GET', timeoutMs: 1000, maxResponseBytes: 5000, decode: (value) => value,
      },
    )).resolves.toEqual({
      ok: false, status: 400, code: null, requestId: null, retryAfterSeconds: null,
    });
  });

  it.each([
    ['0', 1],
    ['90000', 86400],
    ['invalid', null],
  ] as const)('clamps retry-after %s to %s', async (header, expected) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(
      {},
      { status: 503, headers: { 'retry-after': header } },
    ));
    await expect(clientExtension(buildClient(fetchImpl)).requestProjectJson(
      '/billing/entitlements',
      {
        method: 'GET', timeoutMs: 1000, maxResponseBytes: 1000, decode: (value) => value,
      },
    )).resolves.toMatchObject({ ok: false, retryAfterSeconds: expected });
  });

  it('throws the upgrade error for missing and incompatible extensions', () => {
    const expected =
      'This AuthOwl client has no extension support. Upgrade @authowl/react and @authowl/core.';
    expect(() => clientExtension({})).toThrow(expected);
    expect(() => clientExtension({
      [Symbol.for('authowl.core.client-extension.v1')]: { version: 2 },
    })).toThrow(expected);
  });

  it('does not attach the extension through the internal helper accidentally twice', () => {
    const target = {};
    const config = resolveConfig({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: 'https://auth.example.test',
      fetch: vi.fn<typeof fetch>(),
    });
    attachClientExtension(target, config);
    expect(() => attachClientExtension(target, config)).toThrow(TypeError);
  });
});
