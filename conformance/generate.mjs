/**
 * Regenerates the language-neutral AuthOwl conformance vectors.
 *
 * The vectors under `vectors/` are the SINGLE source of truth for the shared
 * security primitives. Each SDK runs the vectors applicable to its runtime:
 *
 *   1. project JWT verification (ES256 over JWKS, iss/aud/exp/nbf)
 *   2. JWKS document parsing (the hardening rules in token-verify.ts)
 *   3. session cookie-name derivation
 *   4. publishable-key decoding (including the `sk_` refusal)
 *   5. organization membership `has()` / `hasPermission()`
 *   6. webhook HMAC verification
 *
 * A vector file is a COMMITTED ARTIFACT, not a build output. Regenerating mints
 * fresh ECDSA signatures (ECDSA is randomized), so the JSON changes on every run
 * even when semantics do not - that is expected and harmless. Correctness is not
 * established by byte-comparing a regeneration; it is established by every SDK's
 * conformance suite re-verifying the committed vectors from scratch. Regenerate
 * only when you are ADDING or CHANGING cases.
 *
 * Usage: node conformance/generate.mjs
 */

import { createHmac, createPrivateKey, sign as signRaw } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'vectors');

/**
 * Fixed P-256 test keys. Generated once for this corpus and committed on
 * purpose: vectors must be reproducible across languages, so the signing key
 * cannot be ephemeral. These sign nothing but test fixtures and are worthless
 * outside this directory.
 */
const PRIMARY = {
  d: 'sa5JgJtXRmfShutnjxVMMCsYE8Rje6WWUrSec5ic33I',
  x: '-ziablu-iFrU5WL6neUOYgrDNPrlRXgMDhhF4p_IJPM',
  y: 'Umrnr969QUVkmkGl2AouWB5CeuqkUhIrk_h9CYJpD8M',
};
const SECONDARY = {
  d: 'Hg1xuOJGYk-IlhH73VKPE73Fz-bX5p2EEKA3aUn5LLA',
  x: 'is0c-CRQtAXbd6HB30hMuLgzXm3aUNQ5onFqu1pnRsg',
  y: '7m64aXwU6ZMnNDGHR0BjAngf__q1PnryjA4zLnjSqh4',
};

const PRIMARY_KID = 'authowl-test-key-1';
const SECONDARY_KID = 'authowl-test-key-2';

/** 2026-01-01T00:00:00Z. Every time-dependent case pins `now` to this. */
const NOW = 1767225600;

const PROJECT_ID = '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60';
// The same id with its hex upper-cased. Every SDK's key grammar accepts
// `[0-9a-fA-F-]` in the uuid segment, so this is a STRUCTURALLY VALID key that a
// case-mangling copy/paste produces without anyone hand-typing anything. Only
// the hex is mangled: the `pk_(live|test)` prefix is case-SENSITIVE in five of
// the six SDKs, so upper-casing that would test "is this rejected as malformed"
// in five languages instead of "is the project id canonicalised" in all six.
// DERIVED, not a second literal: two hand-written uuids drift the moment anyone
// rotates the one above, and the resulting vector would be unsatisfiable - a key
// carrying the OLD id with an `expect.projectId` of the NEW one, failing in all
// six languages at once and pointing at none of them.
const PROJECT_ID_MIXED_CASE = PROJECT_ID.toUpperCase();
const ISSUER = `https://api.authowl.dev/api/projects/${PROJECT_ID}/auth`;
const AUDIENCE = PROJECT_ID;
const JWKS_URI = `${ISSUER}/jwks`;
const AUTHORIZATION_MEMBERSHIP = {
  role: 'member',
  permissions: ['org:reports:read'],
};

function privateKeyOf(jwk) {
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', ...jwk }, format: 'jwk' });
}

function publicJwk(jwk, kid) {
  return { alg: 'ES256', crv: 'P-256', kid, kty: 'EC', use: 'sig', x: jwk.x, y: jwk.y };
}

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(value) {
  return b64url(JSON.stringify(value));
}

/** Sign `header.payload` with ES256, producing the raw r||s (IEEE P1363) form a JWT requires. */
function es256(signingInput, jwk) {
  const signature = signRaw('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKeyOf(jwk),
    dsaEncoding: 'ieee-p1363',
  });
  return b64url(signature);
}

function makeToken({ header = {}, claims = {}, key = PRIMARY, kid = PRIMARY_KID }) {
  const headerSegment = encodeSegment({ alg: 'ES256', typ: 'JWT', kid, ...header });
  const payloadSegment = encodeSegment(claims);
  const signature = es256(`${headerSegment}.${payloadSegment}`, key);
  return `${headerSegment}.${payloadSegment}.${signature}`;
}

/** The baseline claim set: valid on every axis, so each case can spoil exactly one. */
function baseClaims(overrides = {}) {
  return {
    sub: 'user_2p9xKq',
    iss: ISSUER,
    aud: AUDIENCE,
    exp: NOW + 3600,
    iat: NOW - 60,
    ...overrides,
  };
}

const jwtCases = [];

function jwtCase(name, token, expect, extra = {}) {
  jwtCases.push({ name, token, now: NOW, ...extra, expect });
}

// ---------------------------------------------------------------------------
// 1. Accepted tokens
// ---------------------------------------------------------------------------

jwtCase(
  'valid minimal token',
  makeToken({ claims: baseClaims() }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
);

jwtCase(
  'valid token carrying a full membership claim',
  makeToken({
    claims: baseClaims({
      membership: {
        role: 'admin',
        permissions: ['org:sys_members:manage', 'org:billing:read'],
        teams: ['team_alpha', 'team_beta'],
      },
    }),
  }),
  {
    ok: true,
    sub: 'user_2p9xKq',
    membership: {
      role: 'admin',
      permissions: ['org:sys_members:manage', 'org:billing:read'],
      teams: ['team_alpha', 'team_beta'],
    },
  },
);

jwtCase(
  'valid token carrying every role the member holds',
  makeToken({
    claims: baseClaims({
      membership: {
        role: 'admin',
        roles: ['admin', 'editor'],
        permissions: ['org:sys_members:manage', 'org:billing:read'],
        teams: ['team_alpha'],
      },
    }),
  }),
  {
    ok: true,
    sub: 'user_2p9xKq',
    // `roles` must SURVIVE decoding. This is its own case because a reader can
    // gate correctly and still drop the field on the way in - which is exactly
    // what shipped once: the evaluator honoured `roles` while both decoders
    // discarded it, so the fix was inert and every gate silently fell back to
    // the primary role.
    membership: {
      role: 'admin',
      roles: ['admin', 'editor'],
      permissions: ['org:sys_members:manage', 'org:billing:read'],
      teams: ['team_alpha'],
    },
  },
);

jwtCase(
  'valid token with aud as an array containing the audience',
  makeToken({ claims: baseClaims({ aud: ['someone-else', AUDIENCE] }) }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
);

jwtCase(
  'valid token without a sub claim yields a null subject',
  makeToken({ claims: baseClaims({ sub: undefined }) }),
  { ok: true, sub: null, membership: null },
);

jwtCase(
  'non-string sub is normalized to null rather than coerced',
  makeToken({ claims: baseClaims({ sub: 12345 }) }),
  { ok: true, sub: null, membership: null },
);

jwtCase(
  'expired within the clock tolerance is still accepted',
  makeToken({ claims: baseClaims({ exp: NOW - 30 }) }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
  { clockToleranceSeconds: 60 },
);

jwtCase(
  'nbf in the near future within tolerance is accepted',
  makeToken({ claims: baseClaims({ nbf: NOW + 30 }) }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
  { clockToleranceSeconds: 60 },
);

jwtCase(
  'membership with only teams is still a membership',
  makeToken({ claims: baseClaims({ membership: { teams: ['team_alpha'] } }) }),
  {
    ok: true,
    sub: 'user_2p9xKq',
    membership: { role: '', permissions: [], teams: ['team_alpha'] },
  },
);

jwtCase(
  'membership with no role, permissions, or teams decodes to null',
  makeToken({ claims: baseClaims({ membership: { role: '', permissions: [] } }) }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
);

jwtCase(
  'membership drops non-string entries from permissions and teams',
  makeToken({
    claims: baseClaims({
      membership: { role: 'member', permissions: ['org:a:b', 42, null], teams: ['t1', {}] },
    }),
  }),
  {
    ok: true,
    sub: 'user_2p9xKq',
    membership: { role: 'member', permissions: ['org:a:b'], teams: ['t1'] },
  },
);

jwtCase(
  'membership without a teams claim omits teams entirely',
  makeToken({ claims: baseClaims({ membership: { role: 'owner', permissions: [] } }) }),
  { ok: true, sub: 'user_2p9xKq', membership: { role: 'owner', permissions: [] } },
);

jwtCase(
  'a second published key is selected by kid',
  makeToken({ claims: baseClaims(), key: SECONDARY, kid: SECONDARY_KID }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
);

// ---------------------------------------------------------------------------
// Token purpose and JOSE media type. Absent `token_use` remains accepted for
// old on-prem servers unless strict mode is requested. Present-and-wrong is
// always rejected, which closes confusion as soon as a server emits the claim.
// ---------------------------------------------------------------------------

jwtCase(
  'a declared session token is accepted by the default verifier',
  makeToken({
    claims: baseClaims({ token_use: 'session', membership: AUTHORIZATION_MEMBERSHIP }),
  }),
  { ok: true, sub: 'user_2p9xKq', membership: AUTHORIZATION_MEMBERSHIP },
  { authorization: { permission: 'org:reports:read', expect: true } },
);
jwtCase(
  'a declared template token is accepted by the default verifier',
  makeToken({
    claims: baseClaims({ token_use: 'template', membership: AUTHORIZATION_MEMBERSHIP }),
  }),
  { ok: true, sub: 'user_2p9xKq', membership: AUTHORIZATION_MEMBERSHIP },
  { authorization: { permission: 'org:reports:read', expect: false } },
);
jwtCase(
  'an access token requires and accepts at+jwt',
  makeToken({
    header: { typ: 'at+jwt' },
    claims: baseClaims({ token_use: 'access', membership: AUTHORIZATION_MEMBERSHIP }),
  }),
  { ok: true, sub: 'user_2p9xKq', membership: AUTHORIZATION_MEMBERSHIP },
  { authorization: { permission: 'org:reports:read', expect: false } },
);
jwtCase(
  'an ID token is rejected by the default backend verifier',
  makeToken({ claims: baseClaims({ token_use: 'id' }) }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
);
jwtCase(
  'an explicitly narrowed ID-token verifier accepts an ID token',
  makeToken({ claims: baseClaims({ token_use: 'id' }) }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
  { tokenUse: 'id' },
);
jwtCase(
  'a present unknown token purpose is always rejected',
  makeToken({ claims: baseClaims({ token_use: 'mystery' }) }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
);
jwtCase(
  'a present non-string token purpose is always rejected',
  makeToken({ claims: baseClaims({ token_use: null }) }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
);
jwtCase(
  'a declared session token with at+jwt is rejected',
  makeToken({
    header: { typ: 'at+jwt' },
    claims: baseClaims({ token_use: 'session' }),
  }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
);
jwtCase(
  'a declared access token with JWT typ is rejected',
  makeToken({ claims: baseClaims({ token_use: 'access' }) }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
);
jwtCase(
  'an untyped legacy token with the wrong typ is rejected',
  makeToken({ header: { typ: 'at+jwt' }, claims: baseClaims() }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
);
jwtCase(
  'a narrowed session verifier accepts a session token',
  makeToken({ claims: baseClaims({ token_use: 'session' }) }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
  { tokenUse: 'session' },
);
jwtCase(
  'a narrowed session verifier rejects a template token',
  makeToken({ claims: baseClaims({ token_use: 'template' }) }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
  { tokenUse: 'session' },
);
jwtCase(
  'a narrowed access verifier accepts an access token',
  makeToken({
    header: { typ: 'at+jwt' },
    claims: baseClaims({ token_use: 'access' }),
  }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
  { tokenUse: 'access' },
);
jwtCase(
  'a narrowed verifier tolerates an untyped legacy token by default',
  makeToken({ claims: baseClaims() }),
  { ok: true, sub: 'user_2p9xKq', membership: null },
  { tokenUse: 'session' },
);
jwtCase(
  'strict token purpose rejects an untyped legacy token',
  makeToken({ claims: baseClaims() }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
  { tokenUse: 'session', requireTokenUse: true },
);
jwtCase(
  'strict default verification rejects an untyped legacy token',
  makeToken({ claims: baseClaims() }),
  { ok: false, code: 'TOKEN_USE_UNSUPPORTED' },
  { requireTokenUse: true },
);

// ---------------------------------------------------------------------------
// 2. Structural rejection - checked before any signature work
// ---------------------------------------------------------------------------

jwtCase('empty token string', '', { ok: false, code: 'TOKEN_MALFORMED' });
jwtCase('token with two segments', 'aaaa.bbbb', { ok: false, code: 'TOKEN_MALFORMED' });
jwtCase(
  'token with four segments',
  'aaaa.bbbb.cccc.dddd',
  { ok: false, code: 'TOKEN_MALFORMED' },
);
jwtCase(
  'header segment is not base64url',
  `!!!.${encodeSegment(baseClaims())}.${'a'.repeat(86)}`,
  { ok: false, code: 'TOKEN_MALFORMED' },
);
jwtCase(
  'header segment decodes to a JSON array, not an object',
  `${b64url('[1,2,3]')}.${encodeSegment(baseClaims())}.${'a'.repeat(86)}`,
  { ok: false, code: 'TOKEN_MALFORMED' },
);

// ---------------------------------------------------------------------------
// 3. Algorithm confusion - rejected before key resolution
// ---------------------------------------------------------------------------

{
  const header = encodeSegment({ alg: 'none', typ: 'JWT' });
  const payload = encodeSegment(baseClaims());
  jwtCase('alg: none is refused', `${header}.${payload}.`, {
    ok: false,
    code: 'TOKEN_ALGORITHM_UNSUPPORTED',
  });
}

{
  // The classic confusion attack: HMAC the token with the public key material and
  // present it as HS256. Must be refused on `alg` alone, never verified.
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT', kid: PRIMARY_KID });
  const payload = encodeSegment(baseClaims());
  const mac = createHmac('sha256', Buffer.from(PRIMARY.x, 'base64url'))
    .update(`${header}.${payload}`)
    .digest();
  jwtCase('alg: HS256 confusion is refused', `${header}.${payload}.${b64url(mac)}`, {
    ok: false,
    code: 'TOKEN_ALGORITHM_UNSUPPORTED',
  });
}

{
  const header = encodeSegment({ alg: 'RS256', typ: 'JWT', kid: PRIMARY_KID });
  const payload = encodeSegment(baseClaims());
  jwtCase('alg: RS256 is refused', `${header}.${payload}.${'a'.repeat(86)}`, {
    ok: false,
    code: 'TOKEN_ALGORITHM_UNSUPPORTED',
  });
}

{
  const header = encodeSegment({ alg: 'ES384', typ: 'JWT', kid: PRIMARY_KID });
  const payload = encodeSegment(baseClaims());
  jwtCase('alg: ES384 is refused', `${header}.${payload}.${'a'.repeat(86)}`, {
    ok: false,
    code: 'TOKEN_ALGORITHM_UNSUPPORTED',
  });
}

// ---------------------------------------------------------------------------
// 4. Key resolution
// ---------------------------------------------------------------------------

jwtCase(
  'unknown kid resolves to no key',
  makeToken({ claims: baseClaims(), kid: 'kid-that-was-never-published' }),
  { ok: false, code: 'JWKS_KEY_NOT_FOUND' },
);

// ---------------------------------------------------------------------------
// 5. Signature rejection - checked BEFORE claims, so a bad signature always
//    reports as a signature failure even when the claims are also invalid.
// ---------------------------------------------------------------------------

{
  const valid = makeToken({ claims: baseClaims() });
  const [header, , signature] = valid.split('.');
  const swapped = encodeSegment(baseClaims({ sub: 'user_attacker' }));
  jwtCase('tampered payload with the original signature', `${header}.${swapped}.${signature}`, {
    ok: false,
    code: 'TOKEN_SIGNATURE_INVALID',
  });
}

jwtCase(
  'signed by a key that is not the one named in kid',
  makeToken({ claims: baseClaims(), key: SECONDARY, kid: PRIMARY_KID }),
  { ok: false, code: 'TOKEN_SIGNATURE_INVALID' },
);

{
  const valid = makeToken({ claims: baseClaims({ exp: NOW - 999999 }) });
  const [header, payload] = valid.split('.');
  const forged = makeToken({ claims: baseClaims(), key: SECONDARY, kid: PRIMARY_KID })
    .split('.')[2];
  jwtCase(
    'bad signature is reported before the expired claim',
    `${header}.${payload}.${forged}`,
    { ok: false, code: 'TOKEN_SIGNATURE_INVALID' },
  );
}

{
  const valid = makeToken({ claims: baseClaims() });
  const [header, payload] = valid.split('.');
  jwtCase('signature segment of the wrong length', `${header}.${payload}.${'a'.repeat(40)}`, {
    ok: false,
    code: 'TOKEN_MALFORMED',
  });
}

{
  const valid = makeToken({ claims: baseClaims() });
  const [header, payload, signature] = valid.split('.');
  jwtCase(
    'signature segment containing non-base64url characters',
    `${header}.${payload}.${'!'.repeat(86)}`,
    { ok: false, code: 'TOKEN_MALFORMED' },
  );
  void signature;
}

{
  // The payload is unparseable, but the signature legitimately covers those exact
  // bytes - so this must fail on the segment decode, after the signature passes.
  const header = encodeSegment({ alg: 'ES256', typ: 'JWT', kid: PRIMARY_KID });
  const payload = '!!!not-base64url!!!';
  const signature = es256(`${header}.${payload}`, PRIMARY);
  jwtCase(
    'validly signed but unparseable payload segment',
    `${header}.${payload}.${signature}`,
    { ok: false, code: 'TOKEN_MALFORMED' },
  );
}

// ---------------------------------------------------------------------------
// 6. Claim rejection
// ---------------------------------------------------------------------------

jwtCase(
  'expired beyond the clock tolerance',
  makeToken({ claims: baseClaims({ exp: NOW - 3600 }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'missing exp is refused rather than treated as non-expiring',
  makeToken({ claims: baseClaims({ exp: undefined }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'non-numeric exp is refused',
  makeToken({ claims: baseClaims({ exp: '9999999999' }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'nbf beyond the clock tolerance',
  makeToken({ claims: baseClaims({ nbf: NOW + 3600 }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'mismatched issuer',
  makeToken({ claims: baseClaims({ iss: 'https://evil.example.com/auth' }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'missing issuer',
  makeToken({ claims: baseClaims({ iss: undefined }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'issuer differing only by a trailing slash',
  makeToken({ claims: baseClaims({ iss: `${ISSUER}/` }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'mismatched audience',
  makeToken({ claims: baseClaims({ aud: 'some-other-project' }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'missing audience',
  makeToken({ claims: baseClaims({ aud: undefined }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

jwtCase(
  'audience array not containing the expected audience',
  makeToken({ claims: baseClaims({ aud: ['a', 'b'] }) }),
  { ok: false, code: 'TOKEN_CLAIM_INVALID' },
);

// ---------------------------------------------------------------------------
// JWKS document parsing
// ---------------------------------------------------------------------------

const goodKey = publicJwk(PRIMARY, PRIMARY_KID);

const jwksCases = [
  { name: 'a single valid ES256 key', document: { keys: [goodKey] }, expect: { ok: true, keys: 1 } },
  {
    name: 'two valid keys during rotation',
    document: { keys: [goodKey, publicJwk(SECONDARY, SECONDARY_KID)] },
    expect: { ok: true, keys: 2 },
  },
  { name: 'an empty key set is structurally valid', document: { keys: [] }, expect: { ok: true, keys: 0 } },
  {
    name: 'document with extra top-level members',
    document: { keys: [goodKey], extra: true },
    expect: { ok: false, code: 'JWKS_DOCUMENT_INVALID' },
  },
  { name: 'document without a keys array', document: { key: goodKey }, expect: { ok: false, code: 'JWKS_DOCUMENT_INVALID' } },
  { name: 'document that is an array', document: [goodKey], expect: { ok: false, code: 'JWKS_DOCUMENT_INVALID' } },
  { name: 'document that is null', document: null, expect: { ok: false, code: 'JWKS_DOCUMENT_INVALID' } },
  {
    name: 'more than 64 keys',
    document: {
      keys: Array.from({ length: 65 }, (_, index) => ({ ...goodKey, kid: `k${index}` })),
    },
    expect: { ok: false, code: 'JWKS_TOO_MANY_KEYS' },
  },
  {
    name: 'duplicate kid values',
    document: { keys: [goodKey, { ...publicJwk(SECONDARY, PRIMARY_KID) }] },
    expect: { ok: false, code: 'JWKS_DUPLICATE_KID' },
  },
  {
    name: 'key leaking a private d member',
    document: { keys: [{ ...goodKey, d: PRIMARY.d }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key carrying key_ops',
    document: { keys: [{ ...goodKey, key_ops: ['verify'] }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key with an unexpected member',
    document: { keys: [{ ...goodKey, extra: 'nope' }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key on the wrong curve',
    document: { keys: [{ ...goodKey, crv: 'P-384' }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key with the wrong kty',
    document: { keys: [{ ...goodKey, kty: 'RSA' }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key with a non-signature use',
    document: { keys: [{ ...goodKey, use: 'enc' }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key with the wrong alg',
    document: { keys: [{ ...goodKey, alg: 'ES384' }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key with an empty kid',
    document: { keys: [{ ...goodKey, kid: '' }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key with a truncated coordinate',
    document: { keys: [{ ...goodKey, x: 'c2hvcnQ' }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  {
    name: 'key with a non-string coordinate',
    document: { keys: [{ ...goodKey, y: 1234 }] },
    expect: { ok: false, code: 'JWKS_KEY_INVALID' },
  },
  { name: 'a non-object entry in keys', document: { keys: ['nope'] }, expect: { ok: false, code: 'JWKS_KEY_INVALID' } },
];

// ---------------------------------------------------------------------------
// Session cookie names
// ---------------------------------------------------------------------------

const cookieCases = [
  {
    name: 'development (insecure) cookie',
    projectId: PROJECT_ID,
    secure: false,
    expect: 'p_2f1c9a846b3d4e579a105c8d7e2b4f60.session_token',
  },
  {
    name: 'production (secure) cookie',
    projectId: PROJECT_ID,
    secure: true,
    expect: '__Secure-p_2f1c9a846b3d4e579a105c8d7e2b4f60.session_token',
  },
  {
    name: 'secure defaults to false when unspecified',
    projectId: PROJECT_ID,
    expect: 'p_2f1c9a846b3d4e579a105c8d7e2b4f60.session_token',
  },
  {
    name: 'an id with no dashes is passed through unchanged',
    projectId: 'abc123',
    secure: false,
    expect: 'p_abc123.session_token',
  },
  {
    name: 'every dash is stripped, not just the first',
    projectId: 'a-b-c-d-e',
    secure: true,
    expect: '__Secure-p_abcde.session_token',
  },
  // The server's cookie prefix is built from `projects.id`, a Postgres `uuid`,
  // which always renders lowercase - so lowercase is the only name a cookie was
  // ever set under, and cookie names are case-SENSITIVE. An SDK that passes a
  // mixed-case id through names a cookie nothing has: sign-in succeeds and every
  // later request reads as signed out, silently. Pinned in both cookie modes
  // because the secure branch is a separate string in most of these SDKs.
  {
    name: 'a mixed-case project id yields the lowercase name the server set',
    projectId: PROJECT_ID_MIXED_CASE,
    secure: false,
    expect: 'p_2f1c9a846b3d4e579a105c8d7e2b4f60.session_token',
  },
  {
    name: 'a mixed-case project id is lowercased in the secure name too',
    projectId: PROJECT_ID_MIXED_CASE,
    secure: true,
    expect: '__Secure-p_2f1c9a846b3d4e579a105c8d7e2b4f60.session_token',
  },
];

// ---------------------------------------------------------------------------
// Publishable key decoding
// ---------------------------------------------------------------------------

const keyCases = [
  {
    name: 'live publishable key',
    key: `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`,
    expect: { ok: true, prefix: 'pk_live', env: 'live', projectId: PROJECT_ID },
  },
  {
    name: 'test publishable key',
    key: `pk_test_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`,
    expect: { ok: true, prefix: 'pk_test', env: 'test', projectId: PROJECT_ID },
  },
  {
    name: 'a longer random suffix is accepted',
    key: `pk_live_${PROJECT_ID}_${'A1b2C3d4E5f6G7h8I9j0'.repeat(3)}`,
    expect: { ok: true, prefix: 'pk_live', env: 'live', projectId: PROJECT_ID },
  },
  // A case-mangled uuid is a VALID key in every SDK's grammar, so the decoder
  // must canonicalise rather than hand back what it captured. The id is compared
  // byte-for-byte against server-supplied values that are always the lowercase
  // Postgres `uuid` - the JWT `aud`, the public-config `environmentId` - so a
  // verbatim mixed-case id fails those comparisons on a key that is otherwise
  // entirely correct.
  {
    name: 'a case-mangled uuid decodes to the canonical lowercase project id',
    key: `pk_live_${PROJECT_ID_MIXED_CASE}_A1b2C3d4E5f6G7h8I9j0`,
    expect: { ok: true, prefix: 'pk_live', env: 'live', projectId: PROJECT_ID },
  },
  {
    name: 'a secret key is refused outright',
    key: `sk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`,
    expect: { ok: false, reason: 'secret_key' },
  },
  {
    name: 'a secret key is refused regardless of case',
    key: `SK_LIVE_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`,
    expect: { ok: false, reason: 'secret_key' },
  },
  {
    name: 'a bare sk_ prefix is refused before any shape check',
    key: 'sk_',
    expect: { ok: false, reason: 'secret_key' },
  },
  { name: 'an empty key', key: '', expect: { ok: false, reason: 'missing' } },
  { name: 'a key with no environment', key: `pk_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`, expect: { ok: false, reason: 'malformed' } },
  { name: 'an unknown environment', key: `pk_staging_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`, expect: { ok: false, reason: 'malformed' } },
  { name: 'a non-uuid project id', key: 'pk_live_not-a-uuid_A1b2C3d4E5f6G7h8I9j0', expect: { ok: false, reason: 'malformed' } },
  { name: 'a suffix that is too short', key: `pk_live_${PROJECT_ID}_short`, expect: { ok: false, reason: 'malformed' } },
  { name: 'a missing suffix', key: `pk_live_${PROJECT_ID}`, expect: { ok: false, reason: 'malformed' } },
  { name: 'a suffix with a non-base62 character', key: `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j-`, expect: { ok: false, reason: 'malformed' } },
];

// ---------------------------------------------------------------------------
// Membership has() / hasPermission()
// ---------------------------------------------------------------------------

const admin = {
  role: 'admin',
  permissions: ['org:sys_members:manage', 'org:billing:read'],
  teams: ['team_alpha'],
};
const legacy = { role: 'member', permissions: ['org:sys_members:read'] };
// A member holding more than one role. `roles` is sorted, as the engine emits it.
const multiRole = {
  role: 'admin',
  roles: ['admin', 'editor'],
  permissions: ['org:sys_members:manage', 'org:billing:read'],
  teams: ['team_alpha'],
};

const membershipCases = [
  { name: 'no membership denies everything', membership: null, params: { role: 'admin' }, expect: false },
  { name: 'an empty query denies', membership: admin, params: {}, expect: false },
  {
    name: 'an explicitly empty role still participates in a combined query',
    membership: admin,
    params: { role: '', permission: 'org:billing:read' },
    expect: false,
  },
  { name: 'matching role', membership: admin, params: { role: 'admin' }, expect: true },
  {
    // `member.role` is a comma-separated SET server-side, so `admin,editor` is an
    // ordinary membership. Gating on the primary alone made every other role the
    // member holds invisible.
    name: 'a secondary role the member holds is matched',
    membership: multiRole,
    params: { role: 'editor' },
    expect: true,
  },
  {
    name: 'the primary role is still matched when roles is present',
    membership: multiRole,
    params: { role: 'admin' },
    expect: true,
  },
  {
    // THE DISCRIMINATING CASE. When `roles` is present it is the ONLY thing
    // consulted - the primary is not checked separately. An implementation that
    // ORs the primary with the set passes every case above and diverges here.
    name: 'roles alone decides when present, the primary is not consulted',
    membership: { ...multiRole, roles: ['editor'] },
    params: { role: 'admin' },
    expect: false,
  },
  {
    name: 'a role the member does not hold is still refused',
    membership: multiRole,
    params: { role: 'owner' },
    expect: false,
  },
  {
    // A token minted by an older AuthOwl carries no `roles`. Readers must fall
    // back to the primary rather than report the member holds nothing.
    name: 'an absent roles set falls back to the primary role',
    membership: admin,
    params: { role: 'admin' },
    expect: true,
  },
  { name: 'mismatched role', membership: admin, params: { role: 'owner' }, expect: false },
  { name: 'held system permission', membership: admin, params: { permission: 'org:sys_members:manage' }, expect: true },
  { name: 'held custom permission', membership: admin, params: { permission: 'org:billing:read' }, expect: true },
  { name: 'permission that is not held', membership: admin, params: { permission: 'org:billing:write' }, expect: false },
  { name: 'held team', membership: admin, params: { teamId: 'team_alpha' }, expect: true },
  { name: 'team that is not held', membership: admin, params: { teamId: 'team_gamma' }, expect: false },
  {
    name: 'a membership minted before teams shipped can never satisfy teamId',
    membership: legacy,
    params: { teamId: 'team_alpha' },
    expect: false,
  },
  {
    name: 'an explicitly empty teams array also denies',
    membership: { ...legacy, teams: [] },
    params: { teamId: 'team_alpha' },
    expect: false,
  },
  {
    name: 'every criterion must hold (all satisfied)',
    membership: admin,
    params: { role: 'admin', permission: 'org:billing:read', teamId: 'team_alpha' },
    expect: true,
  },
  {
    name: 'every criterion must hold (role fails)',
    membership: admin,
    params: { role: 'owner', permission: 'org:billing:read', teamId: 'team_alpha' },
    expect: false,
  },
  {
    name: 'every criterion must hold (team fails)',
    membership: admin,
    params: { role: 'admin', permission: 'org:billing:read', teamId: 'team_gamma' },
    expect: false,
  },
];

const permissionCases = [
  { name: 'no membership', membership: null, permission: 'org:billing:read', expect: false },
  { name: 'held permission', membership: admin, permission: 'org:billing:read', expect: true },
  { name: 'permission not held', membership: admin, permission: 'org:billing:write', expect: false },
  { name: 'an empty permission string never matches', membership: admin, permission: '', expect: false },
  {
    name: 'no substring or prefix matching is performed',
    membership: admin,
    permission: 'org:billing',
    expect: false,
  },
];

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

const SECRET_A = 'whsec_TESTONLYaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_B = 'whsec_TESTONLYbbbbbbbbbbbbbbbbbbbbbbbb';
const WEBHOOK_BODY = '{"id":"evt_01HQ","type":"user.created","data":{"userId":"user_2p9xKq"}}';

function webhookSignature(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

const wnow = NOW;
const validSigA = webhookSignature(SECRET_A, String(wnow), WEBHOOK_BODY);
const validSigB = webhookSignature(SECRET_B, String(wnow), WEBHOOK_BODY);

const webhookCases = [
  {
    name: 'a correct signature',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: true },
  },
  {
    name: 'the previous secret still verifies during rotation overlap',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigB}`,
    secrets: [SECRET_A, SECRET_B],
    now: wnow,
    expect: { result: true },
  },
  {
    name: 'several offered signatures where one is correct',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${'0'.repeat(64)},v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: true },
  },
  {
    name: 'uppercase hex is accepted',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA.toUpperCase()}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: true },
  },
  {
    name: 'surrounding whitespace on an entry is tolerated',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `  v1=${validSigA}  `,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: true },
  },
  {
    name: 'a timestamp at the edge of the tolerance window',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow + 300,
    expect: { result: true },
  },
  {
    name: 'a signature over a different body',
    rawBody: '{"id":"evt_01HQ","type":"user.deleted"}',
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'a signature produced with an unrelated secret',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigB}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'a timestamp one second past the tolerance window',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow + 301,
    expect: { result: false },
  },
  {
    name: 'a timestamp too far in the future',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow - 301,
    expect: { result: false },
  },
  {
    name: 'a zero tolerance window admits only the exact second',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow + 1,
    toleranceSeconds: 0,
    expect: { result: false },
  },
  {
    name: 'an unversioned signature entry',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: validSigA,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'an unknown signature version',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v2=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'an empty signature header',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: '',
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'more than four offered signatures are refused wholesale',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: [
      `v1=${'0'.repeat(64)}`,
      `v1=${'1'.repeat(64)}`,
      `v1=${'2'.repeat(64)}`,
      `v1=${'3'.repeat(64)}`,
      `v1=${validSigA}`,
    ].join(','),
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'a truncated signature',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA.slice(0, 32)}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'a non-numeric timestamp',
    rawBody: WEBHOOK_BODY,
    timestamp: 'not-a-timestamp',
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'a negative timestamp',
    rawBody: WEBHOOK_BODY,
    timestamp: '-100',
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: false },
  },
  {
    name: 'an empty body signed correctly',
    rawBody: '',
    timestamp: String(wnow),
    signatureHeader: `v1=${webhookSignature(SECRET_A, String(wnow), '')}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: true },
  },
  {
    name: 'a unicode body signed over its exact utf-8 bytes',
    rawBody: '{"name":"Ω πλανήτης","emoji":"🦉"}',
    timestamp: String(wnow),
    signatureHeader: `v1=${webhookSignature(SECRET_A, String(wnow), '{"name":"Ω πλανήτης","emoji":"🦉"}')}`,
    secrets: [SECRET_A],
    now: wnow,
    expect: { result: true },
  },
  // Local misconfiguration must THROW, never quietly reject: a broken endpoint
  // should be loud, not silently drop every delivery.
  {
    name: 'no secrets configured',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [],
    now: wnow,
    expect: { throws: true },
  },
  {
    name: 'more than two secrets configured',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A, SECRET_B, 'whsec_TESTONLYcccccccccccccccccccccccc'],
    now: wnow,
    expect: { throws: true },
  },
  {
    name: 'duplicate secrets configured',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A, SECRET_A],
    now: wnow,
    expect: { throws: true },
  },
  {
    name: 'a secret without the whsec_ prefix',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: ['nope_TESTONLYaaaaaaaaaaaaaaaaaaaaaaaa'],
    now: wnow,
    expect: { throws: true },
  },
  {
    name: 'a negative tolerance',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    toleranceSeconds: -1,
    expect: { throws: true },
  },
  {
    name: 'a tolerance beyond one hour',
    rawBody: WEBHOOK_BODY,
    timestamp: String(wnow),
    signatureHeader: `v1=${validSigA}`,
    secrets: [SECRET_A],
    now: wnow,
    toleranceSeconds: 3601,
    expect: { throws: true },
  },
];

// ---------------------------------------------------------------------------
// Response projection: stripping the engine's durable session token
// ---------------------------------------------------------------------------

/**
 * The client strips the engine's long-lived session token out of exact response
 * families before anything downstream sees them, so a durable credential can
 * never reach application state, a log, or a devtools panel. It is narrow on
 * purpose: reset/delete flows legitimately carry a `token` INPUT, and the
 * separate short-lived `/token` JWT must survive.
 *
 * Pinned here because every non-JavaScript client re-implements it, and a
 * client that forgets one path leaks a session credential without failing
 * anything else.
 */
const projectionCases = [
  {
    name: 'sign-in strips the durable token',
    path: '/sign-in/email',
    payload: { user: { id: 'user_1' }, token: 'durable-session-secret', redirect: false },
    expect: { user: { id: 'user_1' }, redirect: false },
  },
  {
    name: 'every sign-in provider is covered by the prefix rule',
    path: '/sign-in/social',
    payload: { user: { id: 'user_1' }, token: 'durable-session-secret' },
    expect: { user: { id: 'user_1' } },
  },
  {
    name: 'two-factor verification strips the durable token',
    path: '/two-factor/verify-totp',
    payload: { status: true, token: 'durable-session-secret' },
    expect: { status: true },
  },
  {
    name: 'two-factor enable is NOT a verify route and keeps its payload',
    path: '/two-factor/enable',
    payload: { totpURI: 'otpauth://totp/x', backupCodes: ['a'] },
    expect: { totpURI: 'otpauth://totp/x', backupCodes: ['a'] },
  },
  {
    name: 'phone verification strips the durable token',
    path: '/phone-otp/verify',
    payload: { status: true, sessionCreated: true, token: 'durable-session-secret' },
    expect: { status: true, sessionCreated: true },
  },
  {
    name: 'change-password strips the durable token',
    path: '/change-password',
    payload: { status: true, token: 'durable-session-secret' },
    expect: { status: true },
  },
  {
    name: 'sign-up derives sessionCreated from the token it strips',
    path: '/sign-up/email',
    payload: { user: { id: 'user_1' }, token: 'durable-session-secret' },
    expect: { user: { id: 'user_1' }, sessionCreated: true },
  },
  {
    name: 'sign-up without a token reports no session created',
    path: '/sign-up/email',
    payload: { user: { id: 'user_1' } },
    expect: { user: { id: 'user_1' }, sessionCreated: false },
  },
  {
    name: 'sign-up keeps an explicit sessionCreated rather than re-deriving it',
    path: '/sign-up/email',
    payload: { user: { id: 'user_1' }, sessionCreated: false, token: 'durable-session-secret' },
    expect: { user: { id: 'user_1' }, sessionCreated: false },
  },
  {
    name: 'get-session strips the nested session token but keeps the envelope',
    path: '/get-session',
    payload: {
      user: { id: 'user_1' },
      session: { id: 'session_1', token: 'durable-session-secret', userId: 'user_1' },
    },
    expect: {
      user: { id: 'user_1' },
      session: { id: 'session_1', userId: 'user_1' },
    },
  },
  {
    name: 'passkey authentication strips both the top-level and nested token',
    path: '/passkey/verify-authentication',
    payload: {
      token: 'durable-session-secret',
      session: { id: 'session_1', token: 'durable-session-secret' },
    },
    expect: { session: { id: 'session_1' } },
  },
  {
    name: 'list-sessions strips the token from every entry',
    path: '/list-sessions',
    payload: [
      { id: 'session_1', token: 'durable-session-secret' },
      { id: 'session_2', token: 'another-secret' },
    ],
    expect: [{ id: 'session_1' }, { id: 'session_2' }],
  },
  {
    name: 'list-sessions leaves non-object entries alone',
    path: '/list-sessions',
    payload: ['not-a-session', { id: 'session_1', token: 'x' }],
    expect: ['not-a-session', { id: 'session_1' }],
  },
  {
    name: 'password reset keeps its token, which is an INPUT not a session',
    path: '/reset-password',
    payload: { status: true, token: 'reset-token' },
    expect: { status: true, token: 'reset-token' },
  },
  {
    name: 'account deletion keeps its token',
    path: '/delete-user',
    payload: { success: true, token: 'delete-token' },
    expect: { success: true, token: 'delete-token' },
  },
  {
    name: 'an unlisted route is passed through untouched',
    path: '/organization/create',
    payload: { id: 'org_1', token: 'not-a-session-token' },
    expect: { id: 'org_1', token: 'not-a-session-token' },
  },
  {
    name: 'a non-object payload is passed through untouched',
    path: '/sign-in/email',
    payload: 'not-an-object',
    expect: 'not-an-object',
  },
  {
    name: 'a stripped family without a token is unchanged',
    path: '/sign-in/email',
    payload: { user: { id: 'user_1' } },
    expect: { user: { id: 'user_1' } },
  },
];

// ---------------------------------------------------------------------------

const header = {
  $comment:
    'GENERATED by conformance/generate.mjs - do not edit by hand. Committed artifact: '
    + 'each applicable AuthOwl SDK re-verifies these vectors from scratch in its own test suite.',
};

async function emit(name, body) {
  await writeFile(path.join(OUT, name), `${JSON.stringify({ ...header, ...body }, null, 2)}\n`);
  console.log(`wrote vectors/${name}`);
}

await mkdir(OUT, { recursive: true });

await emit('jwt-verify.json', {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUri: JWKS_URI,
  projectId: PROJECT_ID,
  defaultClockToleranceSeconds: 60,
  jwks: { keys: [publicJwk(PRIMARY, PRIMARY_KID), publicJwk(SECONDARY, SECONDARY_KID)] },
  cases: jwtCases,
});
await emit('jwks-parse.json', { cases: jwksCases });
await emit('cookie-name.json', { cases: cookieCases });
await emit('publishable-key.json', { cases: keyCases });
await emit('membership-has.json', { hasCases: membershipCases, hasPermissionCases: permissionCases });
await emit('webhook-verify.json', { defaultToleranceSeconds: 300, cases: webhookCases });
await emit('response-projection.json', { cases: projectionCases });

console.log(
  `\n${jwtCases.length} jwt, ${jwksCases.length} jwks, ${cookieCases.length} cookie, `
  + `${keyCases.length} key, ${membershipCases.length + permissionCases.length} membership, `
  + `${webhookCases.length} webhook, ${projectionCases.length} projection = `
  + `${jwtCases.length + jwksCases.length + cookieCases.length + keyCases.length
    + membershipCases.length + permissionCases.length + webhookCases.length
    + projectionCases.length} vectors`,
);
