import { createHmac, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { has, hasPermission, verifyToken, TokenVerificationError } from './server';

/**
 * The REAL server-side authorization primitive (plan §5): `has()` over a
 * VERIFIED project JWT. Mints ES256 tokens with node:crypto and serves the
 * matching JWKS through a stubbed fetch, then proves the helper verifies the
 * signature / issuer / audience / expiry before trusting the membership claim -
 * and fails CLOSED on any tampered or invalid token.
 */

const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const PK = `pk_live_${PROJECT_ID}_abcdefghij0123456789`;
const API_URL = 'https://auth.example.com';
const ISSUER = `${API_URL}/api/projects/${PROJECT_ID}/auth`;
const JWKS_URI = `${ISSUER}/jwks`;
const KID = 'test-kid-1';

// A SECOND project/JWKS used only by the refetch-cooldown test, so its fetch
// counts stay isolated from the module-level JWKS cache the other tests warm.
const PROJECT_ID2 = '33333333-3333-3333-3333-333333333333';
const PK2 = `pk_live_${PROJECT_ID2}_abcdefghij0123456789`;
const API_URL2 = 'https://auth2.example.com';
const ISSUER2 = `${API_URL2}/api/projects/${PROJECT_ID2}/auth`;
const JWKS_URI2 = `${ISSUER2}/jwks`;

const config = { publishableKey: PK, apiUrl: API_URL };
const membership = {
  role: 'billing_manager',
  permissions: ['org:sys_memberships:create', 'ac:read', 'org:billing:read', 'org:billing:write'],
};

let privateKey: KeyObject;
let publicJwk: Record<string, unknown>;
// A key that is NEVER published in the JWKS - used to sign an otherwise
// well-formed token to prove a foreign signer is rejected.
let foreignPrivateKey: KeyObject;

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function mintToken(overrides: { exp?: number; aud?: string; iss?: string; membership?: unknown } = {}): string {
  const header = { alg: 'ES256', kid: KID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'user-1',
    iss: overrides.iss ?? ISSUER,
    aud: overrides.aud ?? PROJECT_ID,
    iat: now,
    exp: overrides.exp ?? now + 900,
    membership: 'membership' in overrides ? overrides.membership : membership,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // ieee-p1363 yields the raw r||s signature JOSE (and WebCrypto) expects.
  const signature = nodeSign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${signature.toString('base64url')}`;
}

/**
 * Lower-level minter for the fail-closed matrix: full control over the header
 * (alg/kid), which claims are OMITTED (iss/exp), and how the signature is
 * produced (real ES256, a foreign ES256 key, an HS256 alg-confusion attempt, an
 * empty/garbage signature). Defaults to a valid token so each case toggles one
 * thing.
 */
function buildToken(opts: {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  omitIss?: boolean;
  omitExp?: boolean;
  sign?: 'es256' | 'es256-foreign' | 'hs256' | 'none' | 'garbage';
} = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: KID, typ: 'JWT', ...opts.header };
  const payload: Record<string, unknown> = {
    sub: 'user-1',
    iss: ISSUER,
    aud: PROJECT_ID,
    iat: now,
    exp: now + 900,
    membership,
    ...opts.payload,
  };
  if (opts.omitIss) delete payload.iss;
  if (opts.omitExp) delete payload.exp;
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  switch (opts.sign ?? 'es256') {
    case 'none':
      // alg=none family: no signature bytes at all.
      return `${signingInput}.`;
    case 'garbage':
      // Well-formed ES256 header but signature bytes that verify against nothing.
      return `${signingInput}.${b64url('not-a-real-signature')}`;
    case 'hs256': {
      // Classic alg-confusion: HMAC the signing input with the PUBLIC key as the
      // secret. Strict alg-pinning must reject this before any HMAC is trusted.
      const secret = JSON.stringify(publicJwk);
      return `${signingInput}.${createHmac('sha256', secret).update(signingInput).digest('base64url')}`;
    }
    case 'es256-foreign': {
      const sig = nodeSign('sha256', Buffer.from(signingInput), { key: foreignPrivateKey, dsaEncoding: 'ieee-p1363' });
      return `${signingInput}.${sig.toString('base64url')}`;
    }
    default: {
      const sig = nodeSign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
      return `${signingInput}.${sig.toString('base64url')}`;
    }
  }
}

beforeAll(() => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  privateKey = pair.privateKey;
  publicJwk = { ...(pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: KID, use: 'sig', alg: 'ES256' };
  foreignPrivateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const target = String(url);
    if (target === JWKS_URI || target === JWKS_URI2) return Response.json({ keys: [publicJwk] });
    return new Response('not found', { status: 404 });
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('server has() over a verified token', () => {
  it('grants a permission the verified membership carries', async () => {
    const token = mintToken();
    expect(await has(token, { permission: 'org:billing:read' }, config)).toBe(true);
    expect(await hasPermission(token, { permission: 'org:sys_memberships:create' }, config)).toBe(true);
    expect(await has(token, { role: 'billing_manager' }, config)).toBe(true);
  });

  it('denies a permission or role the membership does not carry', async () => {
    const token = mintToken();
    expect(await has(token, { permission: 'org:billing:delete' }, config)).toBe(false);
    expect(await has(token, { role: 'admin' }, config)).toBe(false);
  });

  it('gates on a team the verified token proves, and fails closed without one', async () => {
    const withTeams = mintToken({
      membership: { ...membership, teams: ['team-alpha', 'team-beta'] },
    });
    expect(await has(withTeams, { teamId: 'team-alpha' }, config)).toBe(true);
    expect(await has(withTeams, { teamId: 'team-gamma' }, config)).toBe(false);
    // ANDed with the rest of the claim, not evaluated in isolation.
    expect(await has(withTeams, { role: 'billing_manager', teamId: 'team-beta' }, config)).toBe(true);
    expect(await has(withTeams, { role: 'admin', teamId: 'team-beta' }, config)).toBe(false);

    // A token minted before teams shipped carries no `teams` claim: the team gate
    // must deny rather than treat the absence as permission.
    expect(await has(mintToken(), { teamId: 'team-alpha' }, config)).toBe(false);
  });

  it('carries the teams claim through verification', async () => {
    const verified = await verifyToken(
      mintToken({ membership: { ...membership, teams: ['team-alpha'] } }),
      config,
    );
    expect(verified.membership?.teams).toEqual(['team-alpha']);
    // Absent stays absent - never coerced to an empty array, which would read as
    // "teams were checked and there are none".
    const legacy = await verifyToken(mintToken(), config);
    // Assert the membership itself survived first: `?.teams` would read undefined
    // just as happily on a null membership, passing for the wrong reason.
    expect(legacy.membership).not.toBeNull();
    expect(legacy.membership?.teams).toBeUndefined();
  });

  it('verifyToken returns the subject + membership from the verified claim', async () => {
    const verified = await verifyToken(mintToken(), config);
    expect(verified.sub).toBe('user-1');
    expect(verified.membership).toEqual(membership);
  });

  it('derives issuer/jwks/audience from publishableKey + apiUrl', async () => {
    // Uses the same derived JWKS_URI the stub serves, proving the URL layout
    // matches the app's issuer/jwks/aud contract.
    expect(await has(mintToken(), { permission: 'org:billing:write' }, config)).toBe(true);
  });

  it('fails CLOSED on a tampered signature', async () => {
    const token = mintToken();
    const tampered = `${token.slice(0, -3)}${token.slice(-3) === 'aaa' ? 'bbb' : 'aaa'}`;
    expect(await has(tampered, { permission: 'org:billing:read' }, config)).toBe(false);
    await expect(verifyToken(tampered, config)).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('fails CLOSED on an expired token', async () => {
    const expired = mintToken({ exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(await has(expired, { permission: 'org:billing:read' }, config)).toBe(false);
    await expect(verifyToken(expired, config)).rejects.toThrow(/expired/i);
  });

  it('fails CLOSED on an audience mismatch (token minted for another project)', async () => {
    const wrongAud = mintToken({ aud: '99999999-9999-9999-9999-999999999999' });
    expect(await has(wrongAud, { permission: 'org:billing:read' }, config)).toBe(false);
    await expect(verifyToken(wrongAud, config)).rejects.toThrow(/audience/i);
  });

  it('grants nothing when the verified token carries no membership claim', async () => {
    const nullMembership = mintToken({ membership: null });
    expect(await has(nullMembership, { permission: 'org:billing:read' }, config)).toBe(false);
    expect((await verifyToken(nullMembership, config)).membership).toBeNull();
  });
});

describe('config-DX: a misconfigured backend throws loud, a bad token still fails closed', () => {
  it('throws the clear setup error when neither config nor env is configured', async () => {
    vi.stubEnv('AUTHOWL_PUBLISHABLE_KEY', '');
    vi.stubEnv('AUTHOWL_API_URL', '');
    // A real, valid token is irrelevant - config resolution runs first and must
    // surface the misconfig instead of being swallowed into a silent `false`.
    await expect(has(mintToken(), { permission: 'org:billing:read' }, {})).rejects.toThrow(
      /not configured/i,
    );
    await expect(
      hasPermission(mintToken(), { permission: 'org:billing:read' }, {}),
    ).rejects.toThrow(/not configured/i);
    vi.unstubAllEnvs();
  });

  it('still returns false (fails closed) on a bad token when config IS valid', async () => {
    const bad = tamperPayload(mintToken());
    expect(await has(bad, { permission: 'org:billing:read' }, config)).toBe(false);
    expect(await hasPermission(bad, { permission: 'org:billing:read' }, config)).toBe(false);
  });
});

describe('server has() fail-closed matrix (never throws through as true)', () => {
  // Every entry MUST deny (has=false) AND make verifyToken reject. A single
  // false-negative here is a real authorization bypass.
  const cases: Array<{ name: string; token: () => string; rejects?: RegExp }> = [
    { name: 'alg=none', token: () => buildToken({ header: { alg: 'none' }, sign: 'none' }), rejects: /alg/i },
    { name: 'HS256 alg-confusion (public key as HMAC secret)', token: () => buildToken({ header: { alg: 'HS256' }, sign: 'hs256' }), rejects: /alg/i },
    { name: 'signed by a key not in the JWKS', token: () => buildToken({ sign: 'es256-foreign' }), rejects: /signature/i },
    { name: 'unknown kid', token: () => buildToken({ header: { kid: 'no-such-kid' } }), rejects: /matching JWKS key/i },
    { name: 'wrong issuer', token: () => buildToken({ payload: { iss: 'https://evil.example.com/api/projects/x/auth' } }), rejects: /issuer/i },
    { name: 'missing issuer', token: () => buildToken({ omitIss: true }), rejects: /issuer/i },
    { name: 'wrong audience', token: () => buildToken({ payload: { aud: '99999999-9999-9999-9999-999999999999' } }), rejects: /audience/i },
    { name: 'expired (exp in the past)', token: () => buildToken({ payload: { exp: Math.floor(Date.now() / 1000) - 3600 } }), rejects: /expired/i },
    { name: 'missing exp', token: () => buildToken({ omitExp: true }), rejects: /exp/i },
    { name: 'nbf in the future', token: () => buildToken({ payload: { nbf: Math.floor(Date.now() / 1000) + 3600 } }), rejects: /not yet valid/i },
    { name: 'tampered payload (byte flipped, signature stale)', token: () => tamperPayload(buildToken()), rejects: /signature/i },
    { name: 'garbage signature', token: () => buildToken({ sign: 'garbage' }), rejects: /signature/i },
    { name: 'empty (missing) signature', token: () => buildToken({ sign: 'none' }), rejects: /signature/i },
  ];

  for (const testCase of cases) {
    it(`denies: ${testCase.name}`, async () => {
      const token = testCase.token();
      expect(await has(token, { permission: 'org:billing:read' }, config)).toBe(false);
      expect(await hasPermission(token, { permission: 'org:billing:read' }, config)).toBe(false);
      // A carried role must not leak through an unverified token either.
      expect(await has(token, { role: 'billing_manager' }, config)).toBe(false);
      await expect(verifyToken(token, config)).rejects.toBeInstanceOf(TokenVerificationError);
      if (testCase.rejects) {
        await expect(verifyToken(token, config)).rejects.toThrow(testCase.rejects);
      }
    });
  }
});

// Flip a byte inside the payload segment WITHOUT re-signing, so the signature no
// longer matches the payload it protects.
function tamperPayload(token: string): string {
  const [header, payload, signature] = token.split('.') as [string, string, string];
  const swapped = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
  return `${header}.${swapped}.${signature}`;
}

describe('JWKS refetch cooldown (unknown kids cannot hammer the JWKS endpoint)', () => {
  it('rate-limits forced refetches across a stream of unknown-kid tokens', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    const config2 = { publishableKey: PK2, apiUrl: API_URL2 };

    for (let i = 0; i < 6; i += 1) {
      // Unknown kid fails at key resolution (before iss/aud), so iss/aud here are
      // irrelevant; the point is the JWKS fetch count, not the verdict.
      const token = buildToken({ header: { kid: `ghost-${i}` }, payload: { iss: ISSUER2, aud: PROJECT_ID2 } });
      expect(await has(token, { permission: 'org:billing:read' }, config2)).toBe(false);
    }

    const jwksFetches = fetchMock.mock.calls.filter(([url]) => String(url) === JWKS_URI2).length;
    // First unknown kid: one cache-fill fetch + one forced (cooldown-gated)
    // refetch = 2. The remaining five are denied from the warm cache within the
    // cooldown window and trigger NO further fetches.
    expect(jwksFetches).toBe(2);
  });
});

describe('integration proof: SDK server has() against a real app-shaped default token', () => {
  // The EXACT membership the app's real /token path emits for a `billing_manager`
  // whose role carries system {member:create, ac:read} + custom
  // {org:billing:read, org:billing:write}: dual-emit legacy bare ids + relabelled
  // org:sys_* ids + the custom keys. The app half (authowl
  // tests/auth/organization-token-membership.test.ts) proves a REAL token
  // verifies against the real JWKS with aud=projectId / iss / ES256 and carries
  // this shape; this half proves the SDK's has() accepts it and fails closed on
  // any tamper - together closing the "fail-closed but non-functional" gap.
  const appMembership = {
    role: 'billing_manager',
    permissions: [
      'member:create',
      'ac:read',
      'org:sys_memberships:create',
      'org:sys_roles:read',
      'org:billing:read',
      'org:billing:write',
    ],
  };
  const realShaped = (overrides: { exp?: number; aud?: string } = {}) =>
    mintToken({ membership: appMembership, ...overrides });

  it('accepts a granted system + custom permission and denies an ungranted one', async () => {
    const token = realShaped();
    expect(await has(token, { permission: 'org:billing:read' }, config)).toBe(true);
    expect(await has(token, { permission: 'org:sys_memberships:create' }, config)).toBe(true);
    expect(await hasPermission(token, { permission: 'org:billing:read' }, config)).toBe(true);
    expect(await has(token, { role: 'billing_manager', permission: 'org:billing:read' }, config)).toBe(true);
    // Ungranted permission, and a permission the role lacks, both deny.
    expect(await has(token, { permission: 'org:billing:delete' }, config)).toBe(false);
    expect(await hasPermission(token, { permission: 'org:sys_organization:delete' }, config)).toBe(false);
  });

  it('fails closed on a tampered, expired, or wrong-audience version of that exact token', async () => {
    const token = realShaped();
    expect(await has(tamperPayload(token), { permission: 'org:billing:read' }, config)).toBe(false);
    expect(await has(realShaped({ exp: Math.floor(Date.now() / 1000) - 3600 }), { permission: 'org:billing:read' }, config)).toBe(false);
    expect(await has(realShaped({ aud: '99999999-9999-9999-9999-999999999999' }), { permission: 'org:billing:read' }, config)).toBe(false);
  });
});
