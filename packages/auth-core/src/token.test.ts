import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import { createTokenClient, decodeJwtExpiry } from './token';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

/** An unsigned JWT-shaped token whose payload carries the given claims. */
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

function tokenClient(fetchImpl: typeof fetch) {
  const config = resolveConfig({
    publishableKey: PK,
    apiUrl: 'https://auth.example.com',
    fetch: fetchImpl,
  });
  return createTokenClient(config);
}

const okResponse = (token: string) => new Response(JSON.stringify({ token }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
const namedResponse = (token: string, name: string, policyVersion = 1) => new Response(JSON.stringify({
  token,
  template: {
    id: '22222222-2222-2222-2222-222222222222',
    name,
    policyVersion,
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.useRealTimers());

describe('decodeJwtExpiry', () => {
  it('reads a numeric exp', () => {
    expect(decodeJwtExpiry(fakeJwt({ exp: 1234, sub: 'u' }))).toBe(1234);
  });
  it('returns null for garbage, missing, or non-numeric exp', () => {
    expect(decodeJwtExpiry('not-a-jwt')).toBeNull();
    expect(decodeJwtExpiry(fakeJwt({ sub: 'u' }))).toBeNull();
    expect(decodeJwtExpiry(fakeJwt({ exp: 'soon' }))).toBeNull();
  });
});

describe('getToken', () => {
  it('rejects a JSON-looking success without a JSON content type', async () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ token }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(tokenClient(fetchImpl).getToken()).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'invalid_response',
    });
  });

  it('rejects an oversized token response and preserves only a safe request id', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{}', {
        status: 200,
        headers: {
          'content-length': String(65 * 1024),
          'content-type': 'application/json',
          'x-request-id': 'req-token-too-large',
        },
      }),
    ) as unknown as typeof fetch;

    await expect(tokenClient(fetchImpl).getToken()).rejects.toMatchObject({
      name: 'TransportError',
      kind: 'response_too_large',
      requestId: 'req-token-too-large',
    });
  });

  it('GETs <issuer>/token with the pk header AND credentials (session cookie)', async () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const fetchImpl = vi.fn(async () => okResponse(token)) as unknown as typeof fetch;

    await expect(tokenClient(fetchImpl).getToken()).resolves.toBe(token);

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    // The URL assertion is load-bearing: getToken rides the outer client Proxy,
    // and a routing mistake would silently hit a nonexistent POST
    // /get-token instead of the jwt plugin's GET /token.
    expect(url).toBe(`https://auth.example.com/api/projects/${PROJECT_ID}/auth/token`);
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-publishable-key')).toBe(PK);
    expect(init.credentials).toBe('include');
  });

  it('normalizes a named template and GETs its isolated route', async () => {
    const token = fakeJwt({
      sub: 'user-a',
      org_id: 'org-a',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const fetchImpl = vi.fn(async () => namedResponse(token, 'convex', 3)) as unknown as typeof fetch;

    await expect(tokenClient(fetchImpl).getToken({ template: '  ConVex  ' })).resolves.toBe(token);

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe(`https://auth.example.com/api/projects/${PROJECT_ID}/auth/token/convex`);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('keeps crafted template text inside one encoded route segment', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    await expect(getToken({ template: '../convex' })).rejects.toThrow(/404/);
    await expect(getToken({ template: 'convex%2fother' })).rejects.toThrow(/404/);
    await expect(getToken({ template: '' })).rejects.toThrow(/template missing/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const urls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls
      .map(([url]) => url);
    expect(urls[0]).toContain('/token/..%2Fconvex');
    expect(urls[1]).toContain('/token/convex%252fother');
  });

  it('isolates default and named caches and force-refreshes only the selected template', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const defaultToken = fakeJwt({ sub: 'user-a', exp });
    const convexV1 = fakeJwt({ sub: 'user-a', org_id: 'org-a', exp, version: 1 });
    const supabaseV1 = fakeJwt({ sub: 'user-a', org_id: 'org-a', exp, version: 1 });
    const convexV2 = fakeJwt({ sub: 'user-a', org_id: 'org-a', exp, version: 2 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(defaultToken))
      .mockResolvedValueOnce(namedResponse(convexV1, 'convex', 1))
      .mockResolvedValueOnce(namedResponse(supabaseV1, 'supabase', 1))
      .mockResolvedValueOnce(namedResponse(convexV2, 'convex', 2)) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    await expect(getToken()).resolves.toBe(defaultToken);
    await expect(getToken({ template: 'convex' })).resolves.toBe(convexV1);
    await expect(getToken({ template: 'supabase' })).resolves.toBe(supabaseV1);
    await expect(getToken()).resolves.toBe(defaultToken);
    await expect(getToken({ template: 'convex' })).resolves.toBe(convexV1);
    await expect(getToken({ template: 'supabase' })).resolves.toBe(supabaseV1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await expect(getToken({ template: 'convex', forceRefresh: true })).resolves.toBe(convexV2);
    await expect(getToken({ template: 'convex' })).resolves.toBe(convexV2);
    await expect(getToken({ template: 'supabase' })).resolves.toBe(supabaseV1);
    await expect(getToken()).resolves.toBe(defaultToken);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('keeps a named template called default separate from the unnamed token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const unnamed = fakeJwt({ sub: 'user-a', exp, kind: 'unnamed' });
    const named = fakeJwt({ sub: 'user-a', exp, kind: 'named-default' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(unnamed))
      .mockResolvedValueOnce(namedResponse(named, 'default')) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    await expect(getToken()).resolves.toBe(unnamed);
    await expect(getToken({ template: 'default' })).resolves.toBe(named);
    await expect(getToken()).resolves.toBe(unnamed);
    await expect(getToken({ template: 'default' })).resolves.toBe(named);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not share in-flight work across template names', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const name = String(input).endsWith('/convex') ? 'convex' : 'hasura';
      return namedResponse(fakeJwt({ sub: 'user-a', exp, template: name }), name);
    }) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    const [convex, hasura] = await Promise.all([
      getToken({ template: 'convex' }),
      getToken({ template: 'hasura' }),
    ]);

    expect(convex).not.toBe(hasura);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses invalid named-template policy metadata', async () => {
    const token = fakeJwt({ sub: 'user-a', exp: Math.floor(Date.now() / 1000) + 900 });
    const fetchImpl = vi.fn(async () => namedResponse(token, 'convex', 0)) as unknown as typeof fetch;

    await expect(tokenClient(fetchImpl).getToken({ template: 'convex' }))
      .rejects.toMatchObject({ name: 'TransportError', kind: 'invalid_response' });
  });

  it('serves a fresh token from memory, then refetches once it nears expiry', async () => {
    vi.useFakeTimers();
    const first = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const second = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 1800 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(first))
      .mockResolvedValueOnce(okResponse(second)) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    await expect(getToken()).resolves.toBe(first);
    await expect(getToken()).resolves.toBe(first); // cache hit
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 30s before exp the cache stops serving it (expiry leeway).
    vi.advanceTimersByTime((900 - 15) * 1000);
    await expect(getToken()).resolves.toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh bypasses a perfectly fresh cache (the Convex retry contract)', async () => {
    const first = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const second = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(first))
      .mockResolvedValueOnce(okResponse(second)) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    await expect(getToken()).resolves.toBe(first);
    await expect(getToken({ forceRefresh: true })).resolves.toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The forced mint refreshed the shared cache.
    await expect(getToken()).resolves.toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('concurrent non-forced calls share one request', async () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const fetchImpl = vi.fn(async () => okResponse(token)) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    const [a, b, c] = await Promise.all([getToken(), getToken(), getToken()]);
    expect(a).toBe(token);
    expect(b).toBe(token);
    expect(c).toBe(token);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves null when signed out (401), and recovers after sign-in', async () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(okResponse(token)) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    await expect(getToken()).resolves.toBeNull();
    await expect(getToken()).resolves.toBe(token);
  });

  it('clears every template cache when any mint proves the session is unauthorized', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const convex = fakeJwt({ sub: 'user-a', exp, template: 'convex' });
    const supabase = fakeJwt({ sub: 'user-a', exp, template: 'supabase' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(namedResponse(convex, 'convex'))
      .mockResolvedValueOnce(namedResponse(supabase, 'supabase'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    await expect(getToken({ template: 'convex' })).resolves.toBe(convex);
    await expect(getToken({ template: 'supabase' })).resolves.toBe(supabase);
    await expect(getToken({ template: 'convex', forceRefresh: true })).resolves.toBeNull();
    await expect(getToken({ template: 'supabase' })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('throws on non-401 failures (adapters map to null; callers may retry)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('oops', { status: 500, statusText: 'Internal Server Error' }),
    ) as unknown as typeof fetch;
    await expect(tokenClient(fetchImpl).getToken()).rejects.toThrow(/500/);
  });

  it('does not reflect a hostile status text into an HTTP error', async () => {
    const secret = 'sk_test_NEVER_REFLECT_THIS';
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 500, statusText: secret }),
    ) as unknown as typeof fetch;

    const error = await tokenClient(fetchImpl).getToken().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'AuthOwlHttpError', status: 500 });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect((error as Error).message).not.toContain(secret);
  });

  it('returns but never caches a token without a decodable exp', async () => {
    const fetchImpl = vi.fn(async () => okResponse('opaque-token')) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);
    await expect(getToken()).resolves.toBe('opaque-token');
    await expect(getToken()).resolves.toBe('opaque-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no cache serve
  });

  it('clear() drops the cached token (the auth-identity-change hook)', async () => {
    const first = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const second = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 900 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(first))
      .mockResolvedValueOnce(okResponse(second)) as unknown as typeof fetch;
    const { getToken, clear } = tokenClient(fetchImpl);

    await expect(getToken()).resolves.toBe(first);
    clear(); // e.g. signOut - user B must never receive A's cached token
    await expect(getToken()).resolves.toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a mint in flight across clear() cannot repopulate the cache or serve late joiners', async () => {
    const staleToken = fakeJwt({ sub: 'user-a', exp: Math.floor(Date.now() / 1000) + 900 });
    const freshToken = fakeJwt({ sub: 'user-b', exp: Math.floor(Date.now() / 1000) + 900 });
    let releaseStale!: (r: Response) => void;
    const staleGate = new Promise<Response>((resolve) => {
      releaseStale = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(staleGate) // user A's mint, held in flight
      .mockResolvedValueOnce(okResponse(freshToken)) as unknown as typeof fetch;
    const { getToken, clear } = tokenClient(fetchImpl);

    const stalePromise = getToken(); // A's mint departs
    clear(); // identity switches (sign-out / sign-in as B) while it's in flight

    // A caller arriving AFTER the clear must not be handed A's in-flight mint.
    const freshPromise = getToken();
    releaseStale(okResponse(staleToken));
    await expect(stalePromise).resolves.toBe(staleToken); // A's original caller still gets A's result
    await expect(freshPromise).resolves.toBe(freshToken);

    // And A's late resolution must not have repopulated the cache.
    await expect(getToken()).resolves.toBe(freshToken);
  });

  it('an older in-flight mint cannot overwrite a newer forced mint (last-started wins)', async () => {
    // Org switch without a clear(): a pre-switch non-forced mint is in flight
    // when the adapter's forced new-generation mint completes - the slow old
    // response must not clobber the fresh cache.
    const oldOrg = fakeJwt({ org_id: 'org-a', exp: Math.floor(Date.now() / 1000) + 900 });
    const newOrg = fakeJwt({ org_id: 'org-b', exp: Math.floor(Date.now() / 1000) + 900 });
    let releaseOld!: (r: Response) => void;
    const oldGate = new Promise<Response>((resolve) => {
      releaseOld = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(oldGate) // the slow pre-switch mint
      .mockResolvedValueOnce(okResponse(newOrg)) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    const slowOld = getToken(); // departs first...
    await expect(getToken({ forceRefresh: true })).resolves.toBe(newOrg); // ...forced mint lands first
    releaseOld(okResponse(oldOrg)); // now the old response arrives late
    await expect(slowOld).resolves.toBe(oldOrg);

    // The cache must still hold the NEWER token.
    await expect(getToken()).resolves.toBe(newOrg);
  });

  it('keeps the newest user, organization, and policy tuple for one named template', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const oldIdentity = fakeJwt({ sub: 'user-a', org_id: 'org-a', exp });
    const newIdentity = fakeJwt({ sub: 'user-b', org_id: 'org-b', exp });
    let releaseOld!: (response: Response) => void;
    const oldGate = new Promise<Response>((resolve) => {
      releaseOld = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(oldGate)
      .mockResolvedValueOnce(namedResponse(newIdentity, 'convex', 2)) as unknown as typeof fetch;
    const { getToken } = tokenClient(fetchImpl);

    const slowOld = getToken({ template: 'convex' });
    await expect(getToken({ template: 'convex', forceRefresh: true })).resolves.toBe(newIdentity);
    releaseOld(namedResponse(oldIdentity, 'convex', 1));
    await expect(slowOld).resolves.toBe(oldIdentity);

    await expect(getToken({ template: 'convex' })).resolves.toBe(newIdentity);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
