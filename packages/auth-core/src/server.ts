/** Server-only AuthOwl configuration, cookies, and generated Admin API client. */

import {
  validateProjectTokenOptions,
  verifyValidatedProjectToken,
  type ValidatedVerifyProjectTokenOptions,
  type VerifiedProjectToken,
} from './token-verify';
import { resolveConfig } from './config';
import { membershipHas, membershipHasPermission, type HasParams } from './organization-membership';

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
} from './token-verify';
export type { OrganizationMembership, HasParams } from './organization-membership';

/**
 * How to reach the project's JWKS + what issuer/audience to expect. Either pass
 * `publishableKey` + `apiUrl` (the SDK derives the rest, matching the app's
 * issuer/JWKS layout), or the raw `issuer`/`jwksUri`/`audience` for a fully
 * custom deployment. Falls back to `AUTHOWL_PUBLISHABLE_KEY` / `AUTHOWL_API_URL`
 * from the environment (zero-config), like the rest of the server helpers.
 */
type VerifyTokenConfigCommon = {
  clockToleranceSeconds?: number;
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
  }, resolved.decoded.env === 'test');
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
    const verified = await verifyValidatedProjectToken(token, verifyConfig);
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
    const verified = await verifyValidatedProjectToken(token, verifyConfig);
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
