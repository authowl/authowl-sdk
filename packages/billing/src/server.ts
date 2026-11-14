import {
  AuthOwlAdminApiError,
  AuthOwlAdminNetworkError,
  AuthorizationError,
  createAdminClient,
} from '@authowl/core/server';
import { AuthServiceError, auth, type Session } from '@authowl/next/server';
import type { FeatureParams } from './store';
import {
  decodeEntitlementCheck,
  type BillingReason,
  type EntitlementCheck,
} from './wire';

const FEATURE_PATTERN = /^[a-z0-9_-]{1,128}$/;
const UNAVAILABLE_MESSAGE = 'Billing is unavailable. No feature was granted.';

export type FeatureCheckOptions = Readonly<{
  secretKey?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}>;

export type FeatureCheckInput = Readonly<{
  feature: string;
  userId?: string;
  organizationId?: string;
}>;

export class BillingUnavailableError extends Error {
  constructor(cause: unknown) {
    super(UNAVAILABLE_MESSAGE, { cause });
    this.name = 'BillingUnavailableError';
  }
}

export class FeatureDeniedError extends AuthorizationError {
  readonly feature: string;
  readonly denial: BillingReason | 'not_granted';

  constructor(check: EntitlementCheck) {
    super('forbidden', 'This feature is not available.');
    this.feature = check.feature;
    this.denial = check.reason ?? 'not_granted';
  }
}

function adminFailure(error: unknown): unknown {
  if (error instanceof AuthOwlAdminNetworkError) {
    return new BillingUnavailableError(error);
  }
  if (!(error instanceof AuthOwlAdminApiError)) return error;

  if (error.status === 401) {
    return new TypeError(
      `AuthOwl rejected the billing check with ${error.code}. Billing checks need a project secret key with the billing:read scope.`,
      { cause: error },
    );
  }
  if (error.status === 403 && error.code === 'INSUFFICIENT_SCOPE') {
    return new TypeError(
      "This AuthOwl secret key lacks the billing:read scope. A key's scopes are fixed when it is created: create a new secret key with billing:read.",
      { cause: error },
    );
  }
  if (error.status === 400 || error.status === 403) {
    return new TypeError(
      `AuthOwl rejected the billing check with ${error.code}.`,
      { cause: error },
    );
  }
  if (error.status === 404 || error.status === 429 || error.status >= 500) {
    return new BillingUnavailableError(error);
  }
  return error;
}

function isOrganizationRequired(
  error: unknown,
  input: FeatureCheckInput,
): boolean {
  if (input.userId === undefined || input.organizationId !== undefined) return false;
  if (!(error instanceof TypeError)) return false;
  const cause = error.cause;
  return cause instanceof AuthOwlAdminApiError
    && cause.status === 400
    && cause.code === 'INVALID_REQUEST';
}

function organizationDenied(feature: string): EntitlementCheck {
  return Object.freeze({
    feature,
    allowed: false,
    kind: null,
    balance: null,
    reason: 'no_organization',
    source: 'none',
  });
}

function validateFeature(feature: unknown): asserts feature is string {
  if (typeof feature !== 'string' || !FEATURE_PATTERN.test(feature)) {
    throw new TypeError(`feature must match ${FEATURE_PATTERN.source}.`);
  }
}

/**
 * Make a framework-neutral feature check from any Node server without caching
 * across requests.
 *
 * This entry imports `@authowl/next/server`, so install `@authowl/next` and
 * `next`. Other servers can call `POST /api/v1/billing/check` directly. The
 * secret key comes only from `secretKey` or `AUTHOWL_SECRET_KEY`; a key passed
 * to `initAuth` is not visible here.
 */
export async function checkFeature(
  input: FeatureCheckInput,
  options: FeatureCheckOptions = {},
): Promise<EntitlementCheck> {
  validateFeature(input.feature);
  const secretKey = options.secretKey ?? process.env.AUTHOWL_SECRET_KEY;
  if (!secretKey) {
    throw new TypeError(
      'checkFeature needs an AuthOwl secret key with the billing:read scope. Set AUTHOWL_SECRET_KEY or pass secretKey.',
    );
  }
  const apiUrl = options.apiUrl ?? process.env.AUTHOWL_API_URL;
  const admin = createAdminClient({ secretKey, apiUrl: apiUrl!, fetch: options.fetch });
  const body = {
    feature: input.feature,
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    ...(input.organizationId === undefined
      ? {}
      : { organizationId: input.organizationId }),
  };

  let result: unknown;
  try {
    result = await admin.checkBillingFeature({ body });
  } catch (error) {
    throw adminFailure(error);
  }
  try {
    return decodeEntitlementCheck(result);
  } catch (error) {
    throw new BillingUnavailableError(error);
  }
}

async function sessionCheck(
  feature: string,
  session: NonNullable<Session>,
  options: FeatureCheckOptions | undefined,
): Promise<EntitlementCheck> {
  const input: FeatureCheckInput = {
    feature,
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? undefined,
  };
  try {
    return await checkFeature(input, options);
  } catch (error) {
    // An organization-billed environment without an active organization is a denial.
    if (isOrganizationRequired(error, input)) return organizationDenied(feature);
    throw error;
  }
}

/** Fail closed when the session or billing service is unavailable. */
export async function hasFeature(
  input: FeatureParams,
  options?: FeatureCheckOptions,
): Promise<boolean> {
  validateFeature(input.feature);
  let session: Session;
  try {
    session = await auth();
  } catch (error) {
    if (error instanceof AuthServiceError) return false;
    throw error;
  }
  if (!session) return false;
  try {
    return (await sessionCheck(input.feature, session, options)).allowed;
  } catch (error) {
    if (error instanceof BillingUnavailableError) return false;
    throw error;
  }
}

/**
 * Enforce a feature on the server. A 403 can direct a subject without a billing
 * customer to checkout (`no_customer`) or a subject whose plan lacks the
 * feature to an upgrade (`not_granted`).
 */
export async function requireFeature(
  input: FeatureParams,
  options?: FeatureCheckOptions,
): Promise<EntitlementCheck> {
  validateFeature(input.feature);
  const session = await auth();
  if (!session) {
    throw new AuthorizationError('unauthenticated', 'Authentication is required.');
  }
  const check = await sessionCheck(input.feature, session, options);
  if (!check.allowed) throw new FeatureDeniedError(check);
  return check;
}

export type { BillingReason, EntitlementCheck } from './wire';
