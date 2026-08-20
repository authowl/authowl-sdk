/**
 * Stateless verification of an AuthOwl project JWT for SERVER-side authorization
 * (plan §5). This is the REAL enforcement primitive: unlike the client
 * `<Protect>`/`has()` (advisory, over the browser session), this verifies the
 * token's ES256 signature against the project's published JWKS and checks
 * issuer / audience / expiry before reading any claim. A forged or tampered
 * token fails verification, so no permission is ever granted off an unverified
 * claim.
 *
 * Dependency-free: uses WebCrypto (`globalThis.crypto.subtle`), available in
 * Node 18+ and the Edge runtime, so `@authowl/next` stays lean and Edge-safe.
 */

import type { OrganizationMembership } from './organization-membership';
import { decodeJsonObject } from './response-schema';
import { requestBoundedJson, withoutSessionTransport, TransportError } from './transport';
import { canonicalVerifierUrls } from './url-policy';

export interface VerifiedProjectToken {
  /** The token subject (the signed-in user id), or null if absent. */
  sub: string | null;
  /** The active-org membership carried by the token, or null if none/absent. */
  membership: OrganizationMembership | null;
  /** The full verified claim set, for callers that read additional claims. */
  claims: Record<string, unknown>;
}

export interface VerifyProjectTokenOptions {
  /** Expected `iss` - the project's AuthOwl auth base URL. */
  issuer: string;
  /** The project's published JWKS URL. */
  jwksUri: string;
  /** Expected `aud` - the project id. */
  audience: string;
  /** Clock skew tolerance for exp/nbf, in seconds (default 60). */
  clockToleranceSeconds?: number;
}

declare const VALIDATED_TOKEN_OPTIONS: unique symbol;
export type ValidatedVerifyProjectTokenOptions = VerifyProjectTokenOptions & {
  readonly [VALIDATED_TOKEN_OPTIONS]: true;
};

export class TokenVerificationError extends Error {
  readonly code: TokenVerificationErrorCode;

  constructor(message: string, code: TokenVerificationErrorCode = 'TOKEN_VERIFICATION_FAILED') {
    super(message);
    this.name = 'TokenVerificationError';
    this.code = code;
  }
}

export type TokenVerificationErrorCode =
  | 'TOKEN_VERIFICATION_FAILED'
  | 'TOKEN_CONFIG_INVALID'
  | 'TOKEN_MALFORMED'
  | 'TOKEN_ALGORITHM_UNSUPPORTED'
  | 'TOKEN_SIGNATURE_INVALID'
  | 'TOKEN_CLAIM_INVALID'
  | 'JWKS_FETCH_FAILED'
  | 'JWKS_FETCH_TIMEOUT'
  | 'JWKS_HTTP_ERROR'
  | 'JWKS_RESPONSE_TOO_LARGE'
  | 'JWKS_DOCUMENT_INVALID'
  | 'JWKS_TOO_MANY_KEYS'
  | 'JWKS_KEY_INVALID'
  | 'JWKS_DUPLICATE_KID'
  | 'JWKS_KEY_NOT_FOUND'
  | 'WEBCRYPTO_UNAVAILABLE';

type Jwk = JsonWebKey & {
  alg: 'ES256';
  crv: 'P-256';
  kid: string;
  kty: 'EC';
  use: 'sig';
  x: string;
  y: string;
};

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // matches the server's JWKS cache max-age
const JWKS_FETCH_TIMEOUT_MS = 5_000;
const JWKS_RESPONSE_MAX_BYTES = 64 * 1024;
const JWKS_MAX_KEYS = 64;
// An unknown `kid` may be a freshly rotated key, so we force ONE cache-bypassing
// refetch to try to pick it up. But a stream of bogus/unknown-kid tokens must
// not turn into a stream of JWKS fetches (a cheap amplification DoS), so a
// forced refetch is rate-limited to once per this window per JWKS URI. Legit
// rotation is unaffected: the app keeps signing with the OLD kid for its 300s
// activation window, so by the time a new-kid token appears the JWKS has been
// published long enough for the normal TTL refresh to already carry it.
const JWKS_FORCE_REFETCH_COOLDOWN_MS = 60 * 1000;
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const jwksForcedRefetchAt = new Map<string, number>();

function base64urlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
  const binary = typeof atob === 'function'
    ? atob(padded)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (globalThis as any).Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new TokenVerificationError('Malformed JWT segment.', 'TOKEN_MALFORMED');
    }
    const text = new TextDecoder().decode(base64urlToBytes(value));
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TokenVerificationError('Malformed JWT segment.', 'TOKEN_MALFORMED');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TokenVerificationError) throw error;
    throw new TokenVerificationError('Malformed JWT segment.', 'TOKEN_MALFORMED');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isP256Coordinate(value: unknown): value is string {
  return (
    typeof value === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(value)
    && base64urlToBytes(value).byteLength === 32
  );
}

function parsePublicEs256Jwk(value: unknown): Jwk {
  if (!isRecord(value)) {
    throw new TokenVerificationError('JWKS contains a non-object key.', 'JWKS_KEY_INVALID');
  }
  const allowed = new Set(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
  const privateMembers = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'];
  if (
    'key_ops' in value
    || privateMembers.some((member) => member in value)
    || Object.keys(value).some((member) => !allowed.has(member))
  ) {
    throw new TokenVerificationError(
      'JWKS contains private, key_ops, or unexpected key members.',
      'JWKS_KEY_INVALID',
    );
  }
  if (
    value.kty !== 'EC'
    || value.crv !== 'P-256'
    || value.alg !== 'ES256'
    || value.use !== 'sig'
    || typeof value.kid !== 'string'
    || value.kid.length === 0
    || value.kid.length > 128
    || !/^[A-Za-z0-9_-]+$/.test(value.kid)
    || !isP256Coordinate(value.x)
    || !isP256Coordinate(value.y)
  ) {
    throw new TokenVerificationError(
      'JWKS contains a key outside the AuthOwl ES256 public-key schema.',
      'JWKS_KEY_INVALID',
    );
  }
  return {
    alg: value.alg,
    crv: value.crv,
    kid: value.kid,
    kty: value.kty,
    use: value.use,
    x: value.x,
    y: value.y,
  };
}

/**
 * Exported for the cross-language conformance suite (`conformance/vectors/
 * jwks-parse.json`), which asserts every AuthOwl SDK applies these same
 * hardening rules. Internal: `server.ts` re-exports named symbols only, so this
 * never reaches the package's public surface.
 */
export function parseJwksDocument(parsed: unknown): Jwk[] {
  if (
    !isRecord(parsed)
    || Object.keys(parsed).length !== 1
    || !Array.isArray(parsed.keys)
  ) {
    throw new TokenVerificationError(
      'JWKS response must be an object containing only a keys array.',
      'JWKS_DOCUMENT_INVALID',
    );
  }
  if (parsed.keys.length > JWKS_MAX_KEYS) {
    throw new TokenVerificationError(
      'JWKS response exceeds the 64-key limit.',
      'JWKS_TOO_MANY_KEYS',
    );
  }
  const keys = parsed.keys.map(parsePublicEs256Jwk);
  const kids = new Set<string>();
  for (const key of keys) {
    if (kids.has(key.kid)) {
      throw new TokenVerificationError(
        'JWKS response contains duplicate kid values.',
        'JWKS_DUPLICATE_KID',
      );
    }
    kids.add(key.kid);
  }
  return keys;
}

async function fetchJwks(jwksUri: string, force: boolean): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }
  try {
    const result = await requestBoundedJson({
      // No session, deliberately: a JWKS is a public document, fetched by a
      // verifier that has no user and no cookie jar.
      fetchImpl: withoutSessionTransport(fetch),
      url: jwksUri,
      init: {
        headers: { accept: 'application/json' },
      },
      timeoutMs: JWKS_FETCH_TIMEOUT_MS,
      maxResponseBytes: JWKS_RESPONSE_MAX_BYTES,
      allowHttpLoopback: new URL(jwksUri).protocol === 'http:',
      decode: (value) => decodeJsonObject(value),
    });
    if (!result.response.ok) {
      throw new TokenVerificationError(
        `JWKS fetch returned ${result.response.status}.`,
        'JWKS_HTTP_ERROR',
      );
    }
    const keys = parseJwksDocument(result.data);
    jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
    return keys;
  } catch (error) {
    if (error instanceof TokenVerificationError) throw error;
    if (error instanceof TransportError) {
      switch (error.kind) {
        case 'timeout':
          throw new TokenVerificationError('JWKS fetch timed out.', 'JWKS_FETCH_TIMEOUT');
        case 'response_too_large':
          throw new TokenVerificationError(
            'JWKS response exceeds the 64 KiB limit.',
            'JWKS_RESPONSE_TOO_LARGE',
          );
        case 'invalid_response':
          throw new TokenVerificationError(
            'JWKS response is invalid.',
            'JWKS_DOCUMENT_INVALID',
          );
        case 'aborted':
        case 'network':
          break;
      }
    }
    throw new TokenVerificationError('Failed to fetch JWKS.', 'JWKS_FETCH_FAILED');
  }
}

async function resolveKey(jwksUri: string, kid: string | undefined): Promise<Jwk> {
  const pick = (keys: Jwk[]): Jwk | undefined =>
    kid ? keys.find((k) => k.kid === kid) : keys[0];
  let key = pick(await fetchJwks(jwksUri, false));
  // A kid we have not seen may be a freshly rotated key: refetch once, bypassing
  // the cache, before giving up (mirrors the server's rotate-vs-cache design).
  // Rate-limited so a flood of unknown-kid tokens cannot hammer the JWKS
  // endpoint - once a forced refetch runs, further unknown kids are denied from
  // cache until the cooldown elapses. A legit rotation only needs the one
  // refetch: it then lives in the refreshed cache for every later token.
  if (!key) {
    const lastForced = jwksForcedRefetchAt.get(jwksUri) ?? 0;
    if (Date.now() - lastForced >= JWKS_FORCE_REFETCH_COOLDOWN_MS) {
      jwksForcedRefetchAt.set(jwksUri, Date.now());
      key = pick(await fetchJwks(jwksUri, true));
    }
  }
  if (!key) {
    throw new TokenVerificationError(
      'No matching JWKS key for the token kid.',
      'JWKS_KEY_NOT_FOUND',
    );
  }
  return key;
}

function importVerifyKey(jwk: Jwk): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new TokenVerificationError(
      'WebCrypto is unavailable in this runtime.',
      'WEBCRYPTO_UNAVAILABLE',
    );
  }
  // Import only the standard EC members so a stray `alg`/`use` can never make a
  // strict implementation reject the key.
  return subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  if (Array.isArray(aud)) return aud.includes(expected);
  return false;
}

function readMembership(claims: Record<string, unknown>): OrganizationMembership | null {
  const raw = claims.membership;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const role = typeof record.role === 'string' ? record.role : '';
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.filter((entry): entry is string => typeof entry === 'string')
    : [];
  // Absent on a token minted before multiple roles shipped. Preserve that
  // distinction so legacy tokens continue to authorize against their primary role.
  const roles = Array.isArray(record.roles)
    ? record.roles.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  // Absent on a token minted before teams shipped, which stays undefined rather
  // than [] so `has({ teamId })` cannot be satisfied by a claim that never said so.
  const teams = Array.isArray(record.teams)
    ? record.teams.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  // A membership with only roles or teams is still worth returning.
  if (role === '' && permissions.length === 0 && !roles?.length && !teams?.length) return null;
  return {
    role,
    ...(roles === undefined ? {} : { roles }),
    permissions,
    ...(teams === undefined ? {} : { teams }),
  };
}

/**
 * Verify an AuthOwl project JWT and return its subject, membership, and claims.
 * Throws {@link TokenVerificationError} on any failure (bad signature, wrong
 * issuer/audience, expired, unsupported alg, missing key).
 */
export async function verifyProjectToken(
  token: string,
  options: VerifyProjectTokenOptions,
): Promise<VerifiedProjectToken> {
  return verifyValidatedProjectToken(token, validateProjectTokenOptions(options));
}

export function validateProjectTokenOptions(
  options: VerifyProjectTokenOptions,
  allowHttpLoopback = false,
): ValidatedVerifyProjectTokenOptions {
  if (!options || typeof options !== 'object') {
    throw new TokenVerificationError(
      'Token verification options are required.',
      'TOKEN_CONFIG_INVALID',
    );
  }
  let urls: { issuer: string; jwksUri: string };
  try {
    urls = canonicalVerifierUrls(
      options.issuer,
      options.jwksUri,
      { allowHttpLoopback },
    );
  } catch {
    throw new TokenVerificationError(
      'Token verifier issuer or JWKS URL is invalid.',
      'TOKEN_CONFIG_INVALID',
    );
  }
  if (
    typeof options.audience !== 'string'
    || options.audience.length === 0
    || options.audience.length > 256
  ) {
    throw new TokenVerificationError(
      'Token verifier audience is invalid.',
      'TOKEN_CONFIG_INVALID',
    );
  }
  if (
    options.clockToleranceSeconds !== undefined
    && (
      !Number.isInteger(options.clockToleranceSeconds)
      || options.clockToleranceSeconds < 0
      || options.clockToleranceSeconds > 300
    )
  ) {
    throw new TokenVerificationError(
      'clockToleranceSeconds must be an integer from 0 through 300.',
      'TOKEN_CONFIG_INVALID',
    );
  }
  return {
    ...options,
    ...urls,
  } as ValidatedVerifyProjectTokenOptions;
}

export async function verifyValidatedProjectToken(
  token: string,
  options: ValidatedVerifyProjectTokenOptions,
): Promise<VerifiedProjectToken> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TokenVerificationError('A token string is required.', 'TOKEN_MALFORMED');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenVerificationError('Malformed JWT.', 'TOKEN_MALFORMED');
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = decodeJson(headerB64);
  if (header.alg !== 'ES256') {
    throw new TokenVerificationError(
      'Unsupported JWT algorithm.',
      'TOKEN_ALGORITHM_UNSUPPORTED',
    );
  }

  const key = await resolveKey(options.jwksUri, typeof header.kid === 'string' ? header.kid : undefined);
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await importVerifyKey(key);
  } catch (error) {
    if (error instanceof TokenVerificationError) throw error;
    throw new TokenVerificationError(
      'JWKS key could not be imported.',
      'JWKS_KEY_INVALID',
    );
  }
  let signature: Uint8Array;
  try {
    if (!/^[A-Za-z0-9_-]{86}$/.test(signatureB64)) {
      throw new Error('invalid signature encoding');
    }
    signature = base64urlToBytes(signatureB64);
    if (signature.byteLength !== 64) throw new Error('invalid signature length');
  } catch {
    throw new TokenVerificationError(
      'Malformed JWT signature.',
      'TOKEN_MALFORMED',
    );
  }
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let valid: boolean;
  try {
    valid = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      signature as BufferSource,
      data as BufferSource,
    );
  } catch {
    throw new TokenVerificationError(
      'Token signature verification failed.',
      'TOKEN_SIGNATURE_INVALID',
    );
  }
  if (!valid) {
    throw new TokenVerificationError('Invalid token signature.', 'TOKEN_SIGNATURE_INVALID');
  }

  const claims = decodeJson(payloadB64);
  const tolerance = options.clockToleranceSeconds ?? 60;
  const now = Math.floor(Date.now() / 1000);
  // `exp` is REQUIRED, not skip-if-absent: a token with no expiry would never
  // fail closed on its own, so an absent or non-numeric exp is rejected outright.
  if (typeof claims.exp !== 'number') {
    throw new TokenVerificationError(
      'Token is missing a valid exp claim.',
      'TOKEN_CLAIM_INVALID',
    );
  }
  if (claims.exp + tolerance < now) {
    throw new TokenVerificationError('Token has expired.', 'TOKEN_CLAIM_INVALID');
  }
  // `nbf` is honored when present: a not-yet-valid token is rejected.
  if (typeof claims.nbf === 'number' && claims.nbf - tolerance > now) {
    throw new TokenVerificationError('Token is not yet valid.', 'TOKEN_CLAIM_INVALID');
  }
  // `iss` is REQUIRED and must match: an absent, non-string, or mismatched
  // issuer is rejected (never skip-if-absent).
  if (typeof claims.iss !== 'string' || claims.iss !== options.issuer) {
    throw new TokenVerificationError(
      'Token issuer missing or mismatched.',
      'TOKEN_CLAIM_INVALID',
    );
  }
  // `aud` stays unconditional: it is always required to match.
  if (!audienceMatches(claims.aud, options.audience)) {
    throw new TokenVerificationError('Token audience mismatch.', 'TOKEN_CLAIM_INVALID');
  }

  return {
    sub: typeof claims.sub === 'string' ? claims.sub : null,
    membership: readMembership(claims),
    claims,
  };
}
