/** Server-only AuthOwl configuration, cookies, and generated Admin API client. */

import {
  validateProjectTokenOptions,
  verifyValidatedProjectToken,
  type ValidatedVerifyProjectTokenOptions,
  type VerifiedProjectToken,
  type ProjectTokenUse,
} from './token-verify';
import { resolveConfig } from './config';
import { membershipHas, membershipHasPermission, type HasParams } from './organization-membership';
import {
  AuthorizationError,
  requireAuthWith,
  requireGrantWith,
  requireOrgWith,
  requirePermissionWith,
} from './require-auth';

export { sessionCookieName } from './cookie';
export {
  resolveAuthTarget,
  resolveConfig,
  type AuthConfig,
  type ResolvedAuthConfig,
  type ResolvedAuthTarget,
} from './config';
export {
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
} from './session-transport-contract';
export {
  verifyProjectToken,
  TokenVerificationError,
  type TokenVerificationErrorCode,
  type VerifiedProjectToken,
  type ProjectTokenUse,
} from './token-verify';
export type { OrganizationMembership, HasParams } from './organization-membership';
export { AuthorizationError };
export { isAuthorizationError, type AuthorizationFailureReason } from './require-auth';

/**
 * How to reach the project's JWKS + what issuer/audience to expect. Either pass
 * `publishableKey` + `apiUrl` (the SDK derives the rest, matching the app's
 * issuer/JWKS layout), or the raw `issuer`/`jwksUri`/`audience` for a fully
 * custom deployment. Falls back to `AUTHOWL_PUBLISHABLE_KEY` / `AUTHOWL_API_URL`
 * from the environment (zero-config), like the rest of the server helpers.
 */
type VerifyTokenConfigCommon = {
  clockToleranceSeconds?: number;
  tokenUse?: ProjectTokenUse;
  requireTokenUse?: boolean;
};

export type VerifyTokenConfig =
  | (VerifyTokenConfigCommon & {
    publishableKey: string;
    apiUrl: string;
    issuer?: never;
    jwksUri?: never;
    audience?: never;
  })
  | (VerifyTokenConfigCommon & {
    publishableKey?: never;
    apiUrl?: never;
    issuer: string;
    jwksUri: string;
    audience: string;
  })
  | (VerifyTokenConfigCommon & {
    publishableKey?: never;
    apiUrl?: never;
    issuer?: never;
    jwksUri?: never;
    audience?: never;
  });

const VERIFY_CONFIG_ENDPOINT_KEYS = [
  'publishableKey',
  'apiUrl',
  'issuer',
  'jwksUri',
  'audience',
] as const;
const VERIFY_CONFIG_KEYS = new Set<string>([
  ...VERIFY_CONFIG_ENDPOINT_KEYS,
  'clockToleranceSeconds',
  'tokenUse',
  'requireTokenUse',
]);

function resolveVerifyConfig(config?: VerifyTokenConfig): ValidatedVerifyProjectTokenOptions {
  if (config !== undefined && (!config || typeof config !== 'object')) {
    throw new Error('AuthOwl token verification config must be an object.');
  }
  if (config && Object.keys(config).some((key) => !VERIFY_CONFIG_KEYS.has(key))) {
    throw new Error('AuthOwl token verification config contains an unsupported field.');
  }
  const provided = new Set(
    VERIFY_CONFIG_ENDPOINT_KEYS.filter((key) =>
      Object.prototype.hasOwnProperty.call(config ?? {}, key)),
  );
  const hasDerived = provided.has('publishableKey') || provided.has('apiUrl');
  const hasExplicit =
    provided.has('issuer') || provided.has('jwksUri') || provided.has('audience');

  if (hasDerived && hasExplicit) {
    throw new Error(
      'AuthOwl token verification config cannot mix publishableKey/apiUrl with issuer/jwksUri/audience.',
    );
  }
  if (hasExplicit) {
    if (
      typeof config?.issuer !== 'string'
      || typeof config.jwksUri !== 'string'
      || typeof config.audience !== 'string'
    ) {
      throw new Error(
        'Explicit AuthOwl token verification requires issuer, jwksUri, and audience together.',
      );
    }
    return validateProjectTokenOptions({
      issuer: config.issuer,
      jwksUri: config.jwksUri,
      audience: config.audience,
      clockToleranceSeconds: config.clockToleranceSeconds,
      tokenUse: config.tokenUse,
      requireTokenUse: config.requireTokenUse,
    });
  }

  let publishableKey: string | undefined;
  let apiUrl: string | undefined;
  if (hasDerived) {
    if (typeof config?.publishableKey !== 'string' || typeof config.apiUrl !== 'string') {
      throw new Error(
        'Derived AuthOwl token verification requires publishableKey and apiUrl together.',
      );
    }
    publishableKey = config.publishableKey;
    apiUrl = config.apiUrl;
  } else {
    publishableKey = process.env.AUTHOWL_PUBLISHABLE_KEY;
    apiUrl = process.env.AUTHOWL_API_URL;
  }
  if (!publishableKey || !apiUrl) {
    throw new Error(
      'AuthOwl token verification is not configured. Pass { publishableKey, apiUrl } '
        + '(or issuer/jwksUri/audience), or set AUTHOWL_PUBLISHABLE_KEY and AUTHOWL_API_URL.',
    );
  }
  const resolved = resolveConfig({ publishableKey, apiUrl });
  return validateProjectTokenOptions({
    issuer: resolved.projectBaseURL,
    jwksUri: `${resolved.projectBaseURL}/jwks`,
    audience: resolved.decoded.projectId,
    clockToleranceSeconds: config?.clockToleranceSeconds,
    tokenUse: config?.tokenUse,
    requireTokenUse: config?.requireTokenUse,
  }, resolved.decoded.env === 'test');
}

function requireSessionToken(
  config: ValidatedVerifyProjectTokenOptions,
): ValidatedVerifyProjectTokenOptions {
  return { ...config, tokenUse: 'session' };
}

/**
 * Verify an AuthOwl project JWT and return its subject, membership, and claims.
 * Throws {@link TokenVerificationError} on any failure. Use this when you need
 * the decoded identity; use {@link has}/{@link hasPermission} for a boolean gate.
 */
export async function verifyToken(
  token: string,
  config?: VerifyTokenConfig,
): Promise<VerifiedProjectToken> {
  return verifyValidatedProjectToken(token, resolveVerifyConfig(config));
}

/**
 * The REAL server-side authorization primitive (plan §5): verify the project
 * JWT, then evaluate Clerk-style `has({ role?, permission?, teamId? })` against
 * the token's membership claim. Fails CLOSED - an invalid, tampered, expired, or
 * wrong-audience token returns `false`, never granting access off an unverified
 * claim. Handles both `org:sys_*` and custom `org:<feature>:<action>` ids.
 *
 * `teamId` checks GROUP membership, not authority: teams grant nothing on their
 * own. A token minted before teams shipped proves no team and so denies.
 */
export async function has(
  token: string,
  params: HasParams,
  config?: VerifyTokenConfig,
): Promise<boolean> {
  // Resolve config OUTSIDE the try: a MISCONFIGURED backend (missing env / bad
  // key) throws the LOUD setup error (same as verifyToken), instead of being
  // swallowed into a silent `false` that masks the misconfig. Only a genuine
  // verification failure (bad/expired/wrong-audience token) fails closed.
  const verifyConfig = resolveVerifyConfig(config);
  try {
    const verified = await verifyValidatedProjectToken(token, requireSessionToken(verifyConfig));
    return membershipHas(verified.membership, params);
  } catch {
    return false;
  }
}

/** Verified-token `hasPermission()`: true only when the token grants `permission`. Fails closed. */
export async function hasPermission(
  token: string,
  params: { permission: string },
  config?: VerifyTokenConfig,
): Promise<boolean> {
  // Config resolution stays outside the try - see `has()`: misconfig throws loud,
  // a real verification failure fails closed.
  const verifyConfig = resolveVerifyConfig(config);
  try {
    const verified = await verifyValidatedProjectToken(token, requireSessionToken(verifyConfig));
    return membershipHasPermission(verified.membership, params.permission);
  } catch {
    return false;
  }
}

export {
  AuthOwlAdminApiError,
  AuthOwlAdminNetworkError,
  createAdminClient,
  type AdminApiProblem,
  type AdminClient,
  type AdminClientConfig,
  type AdminOperationInput,
  type AdminOperationResult,
} from './admin-client';
export type {
  components as AdminApiComponents,
  operations as AdminApiOperations,
  paths as AdminApiPaths,
} from './admin-api.generated';
export { ADMIN_API_SPEC_SHA256, type AdminOperationId } from './admin-operations.generated';
export { verifyWebhook, type VerifyWebhookInput } from './webhook';
export {
  mcpProtectedResourceMetadata,
  mcpProtectedResourceMetadataUrl,
  mcpUnauthorizedChallenge,
  type McpProtectedResourceMetadata,
} from './mcp';

/**
 * Verify a token and return its identity, or throw {@link AuthorizationError}
 * with `status: 401`. The gate form of {@link verifyToken}.
 *
 * ```ts
 * const { sub, membership } = await requireAuth(bearerToken);
 * ```
 *
 * Ownership is still yours: this proves who is calling, not what they may
 * touch. See the note on {@link requirePermission}.
 */
export async function requireAuth(
  token: string | null | undefined,
  config?: VerifyTokenConfig,
): Promise<VerifiedProjectToken> {
  // Config resolution stays outside, matching `has()`: a misconfigured backend
  // throws loud rather than being laundered into a 401 that looks like the
  // caller's fault.
  const verifyConfig = resolveVerifyConfig(config);
  return requireAuthWith((value) => verifyValidatedProjectToken(value, verifyConfig), token);
}

/**
 * Verify a token and require it to grant `permission`, or throw
 * {@link AuthorizationError} - `401` when the token is missing or unverifiable,
 * `403` when it verified but lacks the permission.
 *
 * ```ts
 * await requirePermission(bearerToken, 'org:invoices:read');
 * ```
 *
 * **This does not check resource ownership, and cannot.** AuthOwl knows the
 * caller holds `org:invoices:read`; it does not know whether invoice 4471 is
 * theirs. That comparison lives in your handler, against your data:
 *
 * ```ts
 * const { sub } = await requirePermission(token, 'org:invoices:read');
 * const invoice = await db.invoice.find(id);
 * if (invoice.userId !== sub) return forbidden();
 * ```
 */
export async function requirePermission(
  token: string | null | undefined,
  permission: string,
  config?: VerifyTokenConfig,
): Promise<VerifiedProjectToken> {
  const verifyConfig = resolveVerifyConfig(config);
  return requirePermissionWith(
    (value) => verifyValidatedProjectToken(value, requireSessionToken(verifyConfig)),
    token,
    permission,
  );
}

/**
 * Verify a token and require it to satisfy a {@link has} check - any
 * combination of `role`, `permission`, `teamId`. Same status semantics as
 * {@link requirePermission}.
 *
 * `teamId` checks GROUP membership, not authority: teams grant nothing on their
 * own, so requiring one alone is a filter rather than a gate.
 */
export async function requireGrant(
  token: string | null | undefined,
  params: HasParams,
  config?: VerifyTokenConfig,
): Promise<VerifiedProjectToken> {
  const verifyConfig = resolveVerifyConfig(config);
  return requireGrantWith(
    (value) => verifyValidatedProjectToken(value, requireSessionToken(verifyConfig)),
    token,
    params,
  );
}

/**
 * Verify a token and require it to have been minted for `organizationId`, or
 * throw {@link AuthorizationError}.
 *
 * ```ts
 * const { sub } = await requireOrg(token, params.orgId);
 * ```
 *
 * This is the strongest cross-tenant check available from the token alone: it
 * proves which organization the session is acting in. Use it to scope the
 * query, then still compare ownership on the row - knowing the caller is in
 * org X does not establish that invoice 4471 belongs to org X.
 *
 * Fails closed when the token carries no `org_id`.
 */
export async function requireOrg(
  token: string | null | undefined,
  organizationId: string,
  config?: VerifyTokenConfig,
): Promise<VerifiedProjectToken> {
  const verifyConfig = resolveVerifyConfig(config);
  return requireOrgWith(
    (value) => verifyValidatedProjectToken(value, requireSessionToken(verifyConfig)),
    token,
    organizationId,
  );
}
