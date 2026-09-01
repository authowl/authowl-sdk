import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  verifyProjectToken,
  type TokenVerificationErrorCode,
} from './token-verify';
import { has, verifyToken, type VerifyTokenConfig } from './server';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const TEST_KEY = `pk_test_${PROJECT_ID}_abcdefghij0123456789`;
const LIVE_KEY = `pk_live_${PROJECT_ID}_abcdefghij0123456789`;
const ISSUER = `https://issuer.example.com/api/projects/${PROJECT_ID}/auth`;
const KID = '77777777-7777-4777-8777-777777777778';
const nativeFetch = globalThis.fetch;

let publicJwk: Record<string, unknown>;
let urlSequence = 0;

function b64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function token(kid = KID, issuer = ISSUER): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' })),
    b64url(JSON.stringify({ iss: issuer, aud: PROJECT_ID, exp: now + 900 })),
    b64url(new Uint8Array(64)),
  ].join('.');
}

function uniqueJwksUri(): string {
  urlSequence += 1;
  return `https://keys.example.net/test-${urlSequence}`;
}

function options(jwksUri = uniqueJwksUri()) {
  return { issuer: ISSUER, jwksUri, audience: PROJECT_ID };
}

function jwksResponse(keys: unknown[] = [publicJwk], init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ keys }), { ...init, headers });
}

async function expectCode(
  promise: Promise<unknown>,
  code: TokenVerificationErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'TokenVerificationError',
    code,
  });
}

beforeAll(() => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  publicJwk = {
    ...(pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
    alg: 'ES256',
    kid: KID,
    use: 'sig',
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public verifier configuration boundary', () => {
  it.each([
    ['non-loopback HTTP', 'http://keys.example.net/jwks'],
    ['exact loopback HTTP without a test key', 'http://127.0.0.1/jwks'],
    ['numeric loopback alias', 'http://2130706433/jwks'],
    ['credentials', 'https://user:password@keys.example.net/jwks'],
    ['query string', 'https://keys.example.net/jwks?redirect=evil'],
    ['fragment', 'https://keys.example.net/jwks#ignored'],
    ['encoded path', 'https://keys.example.net/%2e%2e/jwks'],
    ['literal path traversal', 'https://keys.example.net/safe/../jwks'],
    ['duplicate path separators', 'https://keys.example.net//jwks'],
  ])('rejects %s before making a JWKS request', async (_name, jwksUri) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expectCode(
      verifyProjectToken(token(), { issuer: ISSUER, jwksUri, audience: PROJECT_ID }),
      'TOKEN_CONFIG_INVALID',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects mixed and partial derived-vs-explicit wrapper configuration', async () => {
    const mixed = {
      publishableKey: TEST_KEY,
      apiUrl: 'https://auth.example.com',
      issuer: ISSUER,
      jwksUri: uniqueJwksUri(),
      audience: PROJECT_ID,
    } as unknown as VerifyTokenConfig;
    await expect(verifyToken(token(), mixed)).rejects.toThrow(/cannot mix/i);

    const partial = {
      publishableKey: TEST_KEY,
    } as unknown as VerifyTokenConfig;
    await expect(verifyToken(token(), partial)).rejects.toThrow(/requires publishableKey and apiUrl/i);

    const unexpected = {
      publishableKey: TEST_KEY,
      apiUrl: 'https://auth.example.com',
      insecure: true,
    } as unknown as VerifyTokenConfig;
    await expect(verifyToken(token(), unexpected)).rejects.toThrow(/unsupported field/i);
  });

  it('keeps fully custom canonical issuer and JWKS paths independent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jwksResponse()));
    await expectCode(
      verifyProjectToken(token(), {
        issuer: ISSUER,
        jwksUri: 'https://independent.example.net/custom/keys',
        audience: PROJECT_ID,
      }),
      'TOKEN_SIGNATURE_INVALID',
    );
  });

  it('allows derived pk_test loopback but rejects derived pk_live loopback', async () => {
    const apiUrl = 'http://localhost:3010';
    const issuer = `${apiUrl}/api/projects/${PROJECT_ID}/auth`;
    vi.stubGlobal('fetch', vi.fn(async () => jwksResponse()));
    await expectCode(
      verifyToken(token(KID, issuer), { publishableKey: TEST_KEY, apiUrl }),
      'TOKEN_SIGNATURE_INVALID',
    );
    await expect(
      verifyToken(token(KID, issuer), { publishableKey: LIVE_KEY, apiUrl }),
    ).rejects.toThrow(/HTTPS/i);
  });

  it('surfaces audience and clock misconfiguration before fail-closed authorization', async () => {
    const invalidAudience = {
      issuer: ISSUER,
      jwksUri: uniqueJwksUri(),
      audience: '',
    } as VerifyTokenConfig;
    await expect(
      has(token(), { permission: 'org:billing:read' }, invalidAudience),
    ).rejects.toMatchObject({ code: 'TOKEN_CONFIG_INVALID' });

    const invalidClock = {
      publishableKey: TEST_KEY,
      apiUrl: 'https://auth.example.com',
      clockToleranceSeconds: 301,
    } as VerifyTokenConfig;
    await expect(
      has(token(), { permission: 'org:billing:read' }, invalidClock),
    ).rejects.toMatchObject({ code: 'TOKEN_CONFIG_INVALID' });

    const invalidTokenUse = {
      publishableKey: TEST_KEY,
      apiUrl: 'https://auth.example.com',
      tokenUse: 'refresh',
    } as unknown as VerifyTokenConfig;
    await expect(
      has(token(), { permission: 'org:billing:read' }, invalidTokenUse),
    ).rejects.toMatchObject({ code: 'TOKEN_CONFIG_INVALID' });

    const invalidStrictFlag = {
      publishableKey: TEST_KEY,
      apiUrl: 'https://auth.example.com',
      requireTokenUse: 'yes',
    } as unknown as VerifyTokenConfig;
    await expect(
      has(token(), { permission: 'org:billing:read' }, invalidStrictFlag),
    ).rejects.toMatchObject({ code: 'TOKEN_CONFIG_INVALID' });

    await expect(
      has('not-a-jwt', { permission: 'org:billing:read' }, {
        publishableKey: TEST_KEY,
        apiUrl: 'https://auth.example.com',
      }),
    ).resolves.toBe(false);
  });
});

describe('bounded JWKS transport', () => {
  it('requires a JSON media type before accepting a JWKS document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }))),
    );
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_DOCUMENT_INVALID');
  });

  it('sets a five-second abort signal and refuses redirects', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jwksResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    await expectCode(verifyProjectToken(token(), options()), 'TOKEN_SIGNATURE_INVALID');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts an unresponsive JWKS fetch after five seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })),
    );
    const verification = verifyProjectToken(token(), options());
    const assertion = expectCode(verification, 'JWKS_FETCH_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  });

  it('keeps the timeout active while a chunked response body is stalled', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        let streamController: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            controller.enqueue(new TextEncoder().encode('{"keys":['));
          },
        });
        init?.signal?.addEventListener('abort', () => {
          streamController.error(new DOMException('aborted', 'AbortError'));
        });
        return new Response(body);
      }),
    );
    const verification = verifyProjectToken(token(), options());
    const assertion = expectCode(verification, 'JWKS_FETCH_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  });

  it('rejects an oversized declared Content-Length before reading the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jwksResponse([], { headers: { 'content-length': String(64 * 1024 + 1) } })),
    );
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_RESPONSE_TOO_LARGE');
  });

  it('enforces the 64 KiB limit while streaming when Content-Length is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(64 * 1024 + 1))));
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_RESPONSE_TOO_LARGE');
  });

  it('rejects oversized content without awaiting a hostile never-settling cancel', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() {
        return new Promise<void>(() => undefined);
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_RESPONSE_TOO_LARGE');
  });

  it('rejects an invalid Content-Length rather than trusting it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jwksResponse([], { headers: { 'content-length': 'not-a-number' } })),
    );
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_DOCUMENT_INVALID');
  });

  it('does not follow a real redirect or contact its target', async () => {
    let targetHits = 0;
    const target = createServer((_request, response) => {
      targetHits += 1;
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    const targetOrigin = await listen(target);
    const redirect = createServer((_request, response) => {
      response.writeHead(302, { location: `${targetOrigin}/jwks` }).end();
    });
    const redirectOrigin = await listen(redirect);
    vi.stubGlobal('fetch', nativeFetch);
    try {
      await expectCode(
        verifyToken(
          token(
            KID,
            `${redirectOrigin}/api/projects/${PROJECT_ID}/auth`,
          ),
          { publishableKey: TEST_KEY, apiUrl: redirectOrigin },
        ),
        'JWKS_FETCH_FAILED',
      );
      expect(targetHits).toBe(0);
    } finally {
      await close(redirect);
      await close(target);
    }
  });
});

describe('strict app-shaped ES256 public JWKS schema', () => {
  it('rejects more than 64 keys', async () => {
    const keys = Array.from({ length: 65 }, (_, index) => ({
      ...publicJwk,
      kid: `key-${index}`,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => jwksResponse(keys)));
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_TOO_MANY_KEYS');
  });

  it('rejects duplicate kid values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jwksResponse([publicJwk, publicJwk])));
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_DUPLICATE_KID');
  });

  it.each([
    ['private key material', { d: 'private' }],
    ['key_ops metadata', { key_ops: ['verify'] }],
    ['unexpected member', { x5u: 'https://evil.example.com/cert' }],
    ['wrong algorithm', { alg: 'ES384' }],
    ['wrong curve', { crv: 'P-384' }],
    ['wrong use', { use: 'enc' }],
    ['missing coordinate', { x: undefined }],
  ])('rejects %s', async (_name, override) => {
    const key = { ...publicJwk, ...override };
    vi.stubGlobal('fetch', vi.fn(async () => jwksResponse([key])));
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_KEY_INVALID');
  });

  it('rejects extra top-level JWKS fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ keys: [publicJwk], attackerControlled: true })),
    );
    await expectCode(verifyProjectToken(token(), options()), 'JWKS_DOCUMENT_INVALID');
  });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
