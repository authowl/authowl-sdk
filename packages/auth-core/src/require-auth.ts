import {
  TokenVerificationError,
  type TokenVerificationErrorCode,
  type VerifiedProjectToken,
} from './token-verify';
import { membershipHas, membershipHasPermission, type HasParams } from './organization-membership';

/**
 * Ergonomic authorization gates over the verified primitives, plan 41.1.
 *
 * These add no trust decision of their own. `requireAuth` is `verifyToken` that
 * throws a typed error instead of returning; the rest layer `has()`-style
 * membership evaluation on top. Everything still fails closed, because the
 * primitives underneath already do.
 *
 * They exist because the shortest path should be the correct one. Before this,
 * a tenant reaching for something middleware-shaped found
 * `createAuthRedirectMiddleware`, which checks cookie NAME presence for UX
 * redirects and verifies nothing at all.
 *
 * **What these cannot do.** They answer who the caller is and what they hold.
 * They cannot know whether that user owns invoice 4471. Resource ownership is a
 * query only your application can write:
 *
 * ```ts
 * const { sub } = await requireAuth(token);
 * const invoice = await db.invoice.find(id);
 * if (invoice.userId !== sub) throw new ForbiddenError('not yours');
 * ```
 *
 * That last check is yours, on every route, and no auth provider can do it for
 * you.
 */

/**
 * Why a gate refused.
 *
 * `unauthenticated` and `forbidden` are separate on purpose, because they are
 * different HTTP answers and collapsing them is a real bug in both directions:
 * answering 401 to an authenticated-but-unauthorized caller invites a
 * pointless re-login loop, and answering 403 to an anonymous one tells them an
 * identity they do not have would not have helped either.
 */
export type AuthorizationFailureReason = 'unauthenticated' | 'forbidden';

/**
 * One message for every unauthenticated outcome. A missing token and an
 * invalid one must be indistinguishable to the caller, and `err.message` in a
 * response body is a common enough pattern that differing text would leak the
 * distinction the `reason` field is careful not to.
 */
const UNAUTHENTICATED_MESSAGE = 'Authentication is required.';

export class AuthorizationError extends Error {
  readonly reason: AuthorizationFailureReason;
  /** 401 for `unauthenticated`, 403 for `forbidden`. */
  readonly status: 401 | 403;
  /**
   * Why verification failed, when a token was supplied. For your logs.
   *
   * Non-enumerable, which is load-bearing rather than tidiness. As a plain
   * class field it survived `JSON.stringify(error)`, so the extremely common
   * `res.status(err.status).json(err)` would have published the per-check
   * oracle - `TOKEN_SIGNATURE_INVALID` versus `TOKEN_CLAIM_INVALID` versus
   * `JWKS_KEY_NOT_FOUND` - that this module's own docs say must never reach a
   * response body. Reading `error.cause` still works; serializing it no longer
   * happens by accident.
   */
  readonly cause?: TokenVerificationError;

  constructor(reason: AuthorizationFailureReason, message: string, cause?: TokenVerificationError) {
    super(message);
    this.name = 'AuthorizationError';
    this.reason = reason;
    this.status = reason === 'unauthenticated' ? 401 : 403;
    Object.defineProperty(this, 'cause', {
      value: cause, enumerable: false, writable: false, configurable: true,
    });
  }
}

/**
 * Type guard for `AuthorizationError`, for callers who cannot rely on
 * `instanceof`.
 *
 * A tenant can end up with two physical copies of `@authowl/core` - depending
 * on it directly alongside `@authowl/next`, or an ESM/CJS split in one process
 * - and then `instanceof` misses and their 401/403 handling silently falls
 * through to a 500. The request is still denied, so this is ergonomics rather
 * than a hole, but a silent one.
 */
export function isAuthorizationError(value: unknown): value is AuthorizationError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.name === 'AuthorizationError'
    && typeof candidate.message === 'string'
    && (
      (candidate.reason === 'unauthenticated' && candidate.status === 401)
      || (candidate.reason === 'forbidden' && candidate.status === 403)
    );
}

/**
 * The verification callable these gates are built on.
 *
 * Injected for two reasons, neither of them performance. `resolveVerifyConfig`
 * lives in `server.ts`, which imports this module, so taking it as a parameter
 * is what keeps that from being a cycle. And it lets the refusal semantics -
 * the 401/403 split, the ordering, the operational passthrough - be tested
 * without minting real ES256 tokens and stubbing a JWKS endpoint, which is the
 * same reason `organization-membership.ts` keeps its evaluators pure.
 */
export type VerifyCallable = (token: string) => Promise<VerifiedProjectToken>;

/**
 * The verification failures that are genuinely the presented token's fault, and
 * so are honestly answered with a 401.
 *
 * An ALLOW-list, deliberately. `TokenVerificationError` also covers the auth
 * server being unreachable, timing out, or serving a malformed JWKS - an
 * outage, not a bad token. Converting those to 401 makes every gated route
 * answer "your credentials are wrong" during an incident, which sends whoever
 * debugs it to the client while the real fault is server-side.
 *
 * Listing the caller's-fault codes rather than the operational ones means a new
 * code added upstream defaults to being rethrown loud. An unknown failure
 * reported as the caller's fault is the mistake worth defaulting away from.
 *
 * `JWKS_KEY_NOT_FOUND` is on this list on purpose: AuthOwl publishes a rotated
 * key for 30 days, so a `kid` that is not in the set belongs to a token far
 * older than that, or to a forgery.
 */
const TOKEN_FAULT_CODES: ReadonlySet<TokenVerificationErrorCode> = new Set([
  'TOKEN_VERIFICATION_FAILED',
  'TOKEN_MALFORMED',
  'TOKEN_ALGORITHM_UNSUPPORTED',
  'TOKEN_SIGNATURE_INVALID',
  'TOKEN_CLAIM_INVALID',
  'TOKEN_USE_UNSUPPORTED',
  'JWKS_KEY_NOT_FOUND',
]);

function requireToken(token: string | null | undefined): string {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new AuthorizationError('unauthenticated', UNAUTHENTICATED_MESSAGE);
  }
  return token;
}

function requireNonEmptyGateValue(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} needs a non-empty value.`);
  }
}

/**
 * Verifies a token and returns its identity, or throws `AuthorizationError`
 * with `reason: 'unauthenticated'`.
 *
 * A missing token and an invalid one are the same answer to the caller. They
 * are distinguishable in `cause`, which carries the underlying
 * `TokenVerificationError` when one exists, for your logs - not for your
 * response body. Telling a client which check its token failed tells an
 * attacker which one to work on next.
 */
export async function requireAuthWith(
  verify: VerifyCallable,
  token: string | null | undefined,
): Promise<VerifiedProjectToken> {
  const presented = requireToken(token);
  let verified: VerifiedProjectToken;
  try {
    verified = await verify(presented);
  } catch (error) {
    if (error instanceof TokenVerificationError && TOKEN_FAULT_CODES.has(error.code)) {
      throw new AuthorizationError('unauthenticated', UNAUTHENTICATED_MESSAGE, error);
    }
    // Everything else is operational, not an authorization outcome: a missing
    // publishable key, an unreachable or malformed JWKS, an unavailable
    // WebCrypto. Those throw loud so they look like what they are.
    //
    // This is where `has()` and these gates deliberately differ. `has()`
    // returns a boolean, so it can only fail closed and answers `false` to an
    // auth-server outage. A gate can tell the difference, and hiding an outage
    // behind a 401 would be worse than useless during one.
    throw error;
  }

  // A verified token carrying no subject identifies nobody, so it cannot
  // answer the question this gate exists to answer. Rejecting it here also
  // disarms a trap in the ownership pattern these docs recommend: with a
  // nullable owner column, `invoice.userId !== sub` is `null !== null`, which
  // is false, and the check silently passes.
  if (verified.sub === null || verified.sub.trim().length === 0) {
    throw new AuthorizationError('unauthenticated', UNAUTHENTICATED_MESSAGE);
  }
  return verified;
}

/**
 * Verifies, then requires the token to satisfy a `has()` check.
 *
 * The order is what produces the right status: verification failure is 401,
 * and only a VERIFIED token that lacks the authority is 403.
 */
export async function requireGrantWith(
  verify: VerifyCallable,
  token: string | null | undefined,
  params: HasParams,
): Promise<VerifiedProjectToken> {
  if (params.role === undefined && params.permission === undefined && params.teamId === undefined) {
    // Denying every request would be the fail-closed answer, and it would also
    // be silent - a conditionally built params object that came out empty
    // would look like a permissions problem forever. This module throws loud
    // for its own misconfiguration; it owes callers the same.
    throw new TypeError('requireGrant needs at least one of role, permission, or teamId.');
  }
  if (params.role !== undefined) requireNonEmptyGateValue(params.role, 'requireGrant role');
  if (params.permission !== undefined) {
    requireNonEmptyGateValue(params.permission, 'requireGrant permission');
  }
  if (params.teamId !== undefined) requireNonEmptyGateValue(params.teamId, 'requireGrant teamId');
  const verified = await requireAuthWith(verify, token);
  if (!membershipHas(verified.membership, params)) {
    throw new AuthorizationError('forbidden', 'Token does not grant the required access.');
  }
  return verified;
}

/**
 * Verifies, then requires the token to have been minted for a specific
 * organization.
 *
 * Separate from `requireGrantWith` because `HasParams` has no org concept, so
 * this is not expressible as a grant check - the org lives in the `org_id`
 * claim rather than in the membership. It is also the strongest check the SDK
 * can make from the token alone against a caller reaching into another
 * tenant's data: it proves which organization the session is acting in, which
 * is the scope your ownership query should be filtered by.
 *
 * Fails closed when the claim is absent. A token minted before organizations,
 * or for a user acting in none, proves no organization and so denies.
 */
export async function requireOrgWith(
  verify: VerifyCallable,
  token: string | null | undefined,
  organizationId: string,
): Promise<VerifiedProjectToken> {
  requireNonEmptyGateValue(organizationId, 'requireOrg organization id');
  const verified = await requireAuthWith(verify, token);
  if (verified.claims.org_id !== organizationId) {
    throw new AuthorizationError('forbidden', 'Token was not minted for this organization.');
  }
  return verified;
}

/** Verifies, then requires a specific permission. 401 if unverified, 403 if unauthorized. */
export async function requirePermissionWith(
  verify: VerifyCallable,
  token: string | null | undefined,
  permission: string,
): Promise<VerifiedProjectToken> {
  requireNonEmptyGateValue(permission, 'requirePermission permission');
  const verified = await requireAuthWith(verify, token);
  if (!membershipHasPermission(verified.membership, permission)) {
    throw new AuthorizationError('forbidden', 'Token does not grant the required permission.');
  }
  return verified;
}
