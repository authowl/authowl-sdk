import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  isAuthorizationError,
  requireAuthWith,
  requireGrantWith,
  requireOrgWith,
  requirePermissionWith,
  type VerifyCallable,
} from './require-auth';
import {
  TokenVerificationError,
  type TokenVerificationErrorCode,
  type VerifiedProjectToken,
} from './token-verify';
import type { OrganizationMembership } from './organization-membership';

/**
 * Plan 41.1. Gates over the verified primitives.
 *
 * The property under test is not "it returns true for a good token" - `has()`
 * already covers that. It is that the gate distinguishes the two refusals
 * correctly and never converts a misconfiguration into an authorization
 * answer, because both mistakes are silent in production and both are the kind
 * a tenant would inherit from us.
 */

const MEMBERSHIP: OrganizationMembership = {
  role: 'admin',
  roles: ['admin'],
  permissions: ['org:invoices:read'],
  teams: ['team-a'],
};

function verified(over: Partial<VerifiedProjectToken> = {}): VerifiedProjectToken {
  return { sub: 'user-1', membership: MEMBERSHIP, claims: {}, ...over };
}

const accepts: VerifyCallable = async () => verified();
const rejects: VerifyCallable = async () => {
  throw new TokenVerificationError('bad signature', 'TOKEN_SIGNATURE_INVALID');
};
/** A misconfigured backend, not an authorization outcome. */
const misconfigured: VerifyCallable = async () => {
  throw new Error('AUTHOWL_PUBLISHABLE_KEY is not set');
};

async function failure(promise: Promise<unknown>): Promise<AuthorizationError> {
  const error = await promise.then(
    () => { throw new Error('expected a rejection, but it resolved'); },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AuthorizationError);
  return error as AuthorizationError;
}

describe('requireAuth', () => {
  it('returns the verified identity when the token is good', async () => {
    await expect(requireAuthWith(accepts, 'token')).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('answers 401 for an absent token and for an unverifiable one alike', async () => {
    // Same answer to the caller by design. A client learning that its token was
    // present-but-invalid rather than missing learns which half to work on.
    for (const absent of [null, undefined, '']) {
      const error = await failure(requireAuthWith(accepts, absent));
      expect(error).toMatchObject({ reason: 'unauthenticated', status: 401 });
      expect(error.cause).toBeUndefined();
    }

    const rejected = await failure(requireAuthWith(rejects, 'token'));
    expect(rejected).toMatchObject({ reason: 'unauthenticated', status: 401 });
    // Distinguishable in `cause` for logs, never in the response.
    expect(rejected.cause).toBeInstanceOf(TokenVerificationError);
    expect(rejected.cause?.code).toBe('TOKEN_SIGNATURE_INVALID');
  });

  it('lets an auth-server outage throw loud instead of blaming the caller', async () => {
    // The gap that made the doc comment above this code a lie: JWKS transport
    // failures are TokenVerificationErrors too, so converting the whole class
    // to 401 meant every gated route answered "your credentials are wrong"
    // during an outage, sending whoever debugged it to the client.
    const outages: TokenVerificationErrorCode[] = [
      'JWKS_FETCH_FAILED',
      'JWKS_FETCH_TIMEOUT',
      'JWKS_HTTP_ERROR',
      'JWKS_RESPONSE_TOO_LARGE',
      'JWKS_DOCUMENT_INVALID',
      'JWKS_TOO_MANY_KEYS',
      'JWKS_KEY_INVALID',
      'JWKS_DUPLICATE_KID',
      'WEBCRYPTO_UNAVAILABLE',
      'TOKEN_CONFIG_INVALID',
    ];
    for (const code of outages) {
      const failing: VerifyCallable = async () => {
        throw new TokenVerificationError(code, code);
      };
      const error = await requireAuthWith(failing, 'token').catch((caught: unknown) => caught);
      expect(error, code).toBeInstanceOf(TokenVerificationError);
      expect(error, code).not.toBeInstanceOf(AuthorizationError);
    }
  });

  it('still answers 401 for every failure that really is the token\'s fault', async () => {
    const tokenFaults: TokenVerificationErrorCode[] = [
      'TOKEN_VERIFICATION_FAILED',
      'TOKEN_MALFORMED',
      'TOKEN_ALGORITHM_UNSUPPORTED',
      'TOKEN_SIGNATURE_INVALID',
      'TOKEN_CLAIM_INVALID',
      'TOKEN_USE_UNSUPPORTED',
      // A kid outside the published set: AuthOwl publishes rotated keys for 30
      // days, so this token is far older than that, or forged.
      'JWKS_KEY_NOT_FOUND',
    ];
    for (const code of tokenFaults) {
      const failing: VerifyCallable = async () => {
        throw new TokenVerificationError(code, code);
      };
      const error = await failure(requireAuthWith(failing, 'token'));
      expect(error, code).toMatchObject({ reason: 'unauthenticated', status: 401 });
    }
  });

  it('lets a misconfiguration throw loud instead of laundering it into a 401', async () => {
    // The failure mode this prevents: a backend with no publishable key set
    // would 401 every request and look like a token problem, sending whoever
    // debugs it to the client. It must look like what it is.
    const error = await requireAuthWith(misconfigured, 'token').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AuthorizationError);
  });
});

describe('requirePermission and requireGrant', () => {
  it('allows a verified token that holds the permission', async () => {
    await expect(requirePermissionWith(accepts, 'token', 'org:invoices:read'))
      .resolves.toMatchObject({ sub: 'user-1' });
    await expect(requireGrantWith(accepts, 'token', { role: 'admin' }))
      .resolves.toMatchObject({ sub: 'user-1' });
  });

  it('answers 403, not 401, when a VERIFIED token lacks the authority', async () => {
    // The distinction that makes these worth having. 401 here would send an
    // already-authenticated user into a pointless re-login loop.
    const denied = await failure(requirePermissionWith(accepts, 'token', 'org:invoices:write'));
    expect(denied).toMatchObject({ reason: 'forbidden', status: 403 });

    const wrongRole = await failure(requireGrantWith(accepts, 'token', { role: 'owner' }));
    expect(wrongRole).toMatchObject({ reason: 'forbidden', status: 403 });
  });

  it('answers 401 when the token itself never verified, before authority is considered', async () => {
    // Order matters: an unverifiable token must not be reported as merely
    // under-privileged, which would imply a valid identity it does not have.
    const missing = await failure(requirePermissionWith(accepts, null, 'org:invoices:read'));
    expect(missing).toMatchObject({ reason: 'unauthenticated', status: 401 });

    const invalid = await failure(requirePermissionWith(rejects, 'token', 'org:invoices:read'));
    expect(invalid).toMatchObject({ reason: 'unauthenticated', status: 401 });
  });

  it('fails closed for a token carrying no membership at all', async () => {
    // A token minted before organizations shipped, or for a user in none.
    // Absent membership grants nothing; it must not read as unrestricted.
    const noMembership: VerifyCallable = async () => verified({ membership: null });
    const denied = await failure(requirePermissionWith(noMembership, 'token', 'org:invoices:read'));
    expect(denied).toMatchObject({ reason: 'forbidden', status: 403 });
    // But the caller IS authenticated, so identity still resolves.
    await expect(requireAuthWith(noMembership, 'token')).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('treats a team as grouping, never as authority', async () => {
    // Teams grant nothing on their own - requiring one is a filter, not a gate.
    // Asserted so a later change cannot quietly make team membership imply
    // permission.
    await expect(requireGrantWith(accepts, 'token', { teamId: 'team-a' }))
      .resolves.toMatchObject({ sub: 'user-1' });
    const wrongTeam = await failure(requireGrantWith(accepts, 'token', { teamId: 'team-b' }));
    expect(wrongTeam).toMatchObject({ reason: 'forbidden', status: 403 });
  });
});

describe('requireOrg', () => {
  const inOrg: VerifyCallable = async () => verified({ claims: { org_id: 'org-1' } });

  it('allows a token minted for the organization and denies one that was not', async () => {
    await expect(requireOrgWith(inOrg, 'token', 'org-1')).resolves.toMatchObject({ sub: 'user-1' });
    const wrong = await failure(requireOrgWith(inOrg, 'token', 'org-2'));
    expect(wrong).toMatchObject({ reason: 'forbidden', status: 403 });
  });

  it('fails closed when the token carries no organization at all', async () => {
    // A token minted before organizations, or for a user acting in none,
    // proves no organization. Absent must not read as "any".
    const noOrg: VerifyCallable = async () => verified({ claims: {} });
    const denied = await failure(requireOrgWith(noOrg, 'token', 'org-1'));
    expect(denied).toMatchObject({ reason: 'forbidden', status: 403 });
  });

  it('refuses an empty organization id loudly rather than denying everything', async () => {
    await expect(requireOrgWith(inOrg, 'token', '')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('AuthorizationError', () => {
  it('keeps cause out of naive serialization while leaving it readable', async () => {
    // The leak this prevents: as a plain class field, `cause` survived
    // JSON.stringify, so `res.status(err.status).json(err)` published the
    // per-check oracle - TOKEN_SIGNATURE_INVALID vs TOKEN_CLAIM_INVALID - that
    // this module's own docs say must never reach a response body.
    const error = await failure(requireAuthWith(rejects, 'token'));
    expect(error.cause).toBeInstanceOf(TokenVerificationError);
    expect(JSON.stringify(error)).not.toContain('TOKEN_SIGNATURE_INVALID');
    expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty('cause');
  });

  it('says the same thing for a missing token as for an invalid one', async () => {
    // `err.message` in a response body is common enough that differing text
    // would leak the distinction `reason` is careful not to.
    const absent = await failure(requireAuthWith(accepts, null));
    const invalid = await failure(requireAuthWith(rejects, 'token'));
    expect(absent.message).toBe(invalid.message);
  });

  it('is recognizable without instanceof, for tenants with two copies of core', async () => {
    const error = await failure(requireAuthWith(accepts, null));
    expect(isAuthorizationError(error)).toBe(true);
    expect(isAuthorizationError({
      name: 'AuthorizationError',
      message: error.message,
      reason: 'unauthenticated',
      status: 401,
    })).toBe(true);
    expect(isAuthorizationError({
      name: 'AuthorizationError',
      message: error.message,
      reason: 'forbidden',
      status: 401,
    })).toBe(false);
    expect(isAuthorizationError({
      name: 'AuthorizationError',
      message: error.message,
      status: 418,
    })).toBe(false);
    expect(isAuthorizationError(new Error('nope'))).toBe(false);
    expect(isAuthorizationError(null)).toBe(false);
  });
});

describe('empty gates fail loud, not silently forbidden', () => {
  it('refuses empty gate criteria instead of silently denying every request', async () => {
    // Denying every request would be fail-closed and silent: a conditionally
    // built params object that came out empty would look like a permissions
    // problem forever. A 403 also asserts the user lacked authority, which is
    // untrue when nothing was ever evaluated.
    await expect(requireGrantWith(accepts, 'token', {})).rejects.toBeInstanceOf(TypeError);
    await expect(requirePermissionWith(accepts, 'token', '')).rejects.toBeInstanceOf(TypeError);
    await expect(requirePermissionWith(accepts, 'token', '   ')).rejects.toBeInstanceOf(TypeError);
    await expect(requireGrantWith(accepts, 'token', { role: '' })).rejects.toBeInstanceOf(TypeError);
    await expect(requireGrantWith(accepts, 'token', { permission: '   ' }))
      .rejects.toBeInstanceOf(TypeError);
    await expect(requireGrantWith(accepts, 'token', { teamId: '' }))
      .rejects.toBeInstanceOf(TypeError);
    await expect(requireOrgWith(accepts, 'token', '   ')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('requireAuth rejects a verified token that identifies nobody', () => {
  it('denies a null or empty subject rather than handing back an unusable identity', async () => {
    // Disarms a trap in the ownership pattern these docs recommend: with a
    // nullable owner column, `invoice.userId !== sub` is `null !== null`,
    // which is false, and the check silently passes.
    const anonymous: VerifyCallable = async () => verified({ sub: null });
    const denied = await failure(requireAuthWith(anonymous, 'token'));
    expect(denied).toMatchObject({ reason: 'unauthenticated', status: 401 });

    const empty: VerifyCallable = async () => verified({ sub: '   ' });
    const emptyDenied = await failure(requireAuthWith(empty, 'token'));
    expect(emptyDenied).toMatchObject({ reason: 'unauthenticated', status: 401 });
  });
});
