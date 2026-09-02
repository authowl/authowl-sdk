import { headers as nextHeaders, cookies as nextCookies } from 'next/headers.js';
import {
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
  sessionCookieName,
} from '@authowl/core/server';
import {
  AUTHOWL_SECRET_KEY_HEADER,
  appSessionCookieNames,
} from './bridge-contract';
import {
  getAuthConfig,
  initAuthConfig,
  type AuthOwlNextServerConfig,
} from './server-config';

export {
  createAuthOwlSessionBridge,
  type AuthOwlSessionBridgeOptions,
} from './session-bridge';

/**
 * Verified-token authorization primitives (plan §5). Backends verify a project
 * JWT's signature against the project's JWKS and check issuer/audience/expiry
 * before reading its membership claim, then gate on Clerk-style `has()`. This is
 * the REAL boundary, distinct from the advisory client `<Protect>`/`has()`. With
 * `AUTHOWL_PUBLISHABLE_KEY` + `AUTHOWL_API_URL` set they need no config argument.
 */
export {
  has,
  hasPermission,
  verifyToken,
  TokenVerificationError,
  type VerifyTokenConfig,
  type VerifiedProjectToken,
  type OrganizationMembership,
  type HasParams,
} from '@authowl/core/server';

/**
 * The same boundary in gate form: these throw {@link AuthorizationError}
 * instead of returning a boolean, so a route handler reads as a guard clause
 * and a forgotten `if` cannot silently allow the request through.
 *
 * `status` is 401 when no usable token was presented and 403 when a verified
 * token lacked the authority, which are different answers and should not be
 * collapsed.
 *
 * They still cannot check resource ownership - that comparison needs your data
 * and lives in your handler.
 */
export {
  requireAuth,
  requireGrant,
  requireOrg,
  requirePermission,
  isAuthorizationError,
  AuthorizationError,
  type AuthorizationFailureReason,
} from '@authowl/core/server';

export type Session = {
  user: {
    id: string;
    email: string | null;
    phoneNumber?: string | null;
    name?: string | null;
    image?: string | null;
  };
  session: {
    id: string;
    expiresAt: string;
    activeOrganizationId?: string | null;
    /**
     * The active-org membership (role + advisory permission claim), mirrored
     * from `/get-session`. UX affordance only - for real authorization verify a
     * project token and use the server `has()` over the VERIFIED claim.
     */
    membership?: { role: string; permissions: string[] } | null;
  };
} | null;

const AUTH_FETCH_TIMEOUT_MS = 10_000;

export class AuthServiceError extends Error {
  public readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AuthServiceError';
    this.status = options.status;
  }
}

/**
 * Initialize the SDK explicitly. Optional: if unset, the SDK reads
 * `AUTHOWL_PUBLISHABLE_KEY` / `AUTHOWL_API_URL` from the environment on first use
 * (zero-config). Call this only to override the env, or to surface config errors
 * eagerly at boot rather than on the first request. The publishableKey is sent on
 * every server-side call too (a server fetch has no Origin, but the publishable
 * key + bearer cookie still identify the project on the auth server).
 */
export function initAuth(config: AuthOwlNextServerConfig): void {
  initAuthConfig(config);
}

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  if (typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeoutId) };
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * Get the current session by forwarding only the expected auth session
 * cookie to the auth server. Returns null if not signed in.
 *
 * A native AuthOwl cookie is preferred when the application and auth service
 * can share it. Otherwise the validated app-origin bridge cookie is forwarded
 * through AuthOwl's paired bearer transport. Unrelated cookies are not sent.
 */
export async function auth(): Promise<Session> {
  const cfg = getAuthConfig();
  const projectId = cfg.projectId;
  // The server sets secure (__Secure-) cookies in production; the auth API URL's
  // protocol tells us which mode it runs in (https => secure).
  const secure = new URL(cfg.apiUrl).protocol === 'https:';
  const cookieName = sessionCookieName(projectId, { secure });
  const cookieStore = await nextCookies();
  const allCookies = cookieStore.getAll();
  const cookieHeader = allCookies
    .filter((c) => c.name === cookieName)
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
  const bridgeNames = appSessionCookieNames(projectId);
  const bridgeToken = cookieHeader
    ? null
    : allCookies.find((cookie) => cookie.name === bridgeNames.secure)?.value
      ?? allCookies.find((cookie) => cookie.name === bridgeNames.local)?.value
      ?? null;

  const hdrs = await nextHeaders();
  const url = `${new URL(cfg.apiUrl).origin}/api/projects/${projectId}/auth/get-session`;

  const timeout = createTimeoutSignal(AUTH_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        'x-publishable-key': cfg.publishableKey,
        'user-agent': hdrs.get('user-agent') ?? 'next-auth-helper',
        ...(bridgeToken
          ? {
              authorization: `Bearer ${bridgeToken}`,
              [SESSION_TRANSPORT_HEADER]: SESSION_TRANSPORT_BEARER,
              ...(cfg.secretKey
                ? { [AUTHOWL_SECRET_KEY_HEADER]: cfg.secretKey }
                : {}),
            }
          : {}),
      },
      cache: 'no-store',
      signal: timeout.signal,
    });
  } catch (error) {
    const message = isTimeoutError(error)
      ? `Auth service request timed out after ${AUTH_FETCH_TIMEOUT_MS}ms.`
      : 'Auth service request failed.';
    throw new AuthServiceError(message, { cause: error });
  } finally {
    timeout.cleanup();
  }

  if (res.status === 401) return null;
  if (!res.ok) {
    throw new AuthServiceError(`Auth service returned ${res.status} ${res.statusText}`.trim(), {
      status: res.status,
    });
  }
  try {
    const data = (await res.json()) as Session;
    if (!data || !(data as { user?: unknown }).user) return null;
    // A session held at required-MFA enrolment is unauthenticated for app
    // purposes (CONTRACTS §5) - the client-side <MFARequiredGate/> owns the
    // enrolment routing; server code just sees "not signed in".
    const session = (data as { session?: { pendingMfaEnrollment?: boolean } }).session;
    if (session?.pendingMfaEnrollment === true) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Cheap presence check for UI routing only. This does not validate the session;
 * call auth() for any authorization decision.
 */
export async function hasAuthOwlSessionCookie(): Promise<boolean> {
  const cfg = getAuthConfig();
  const secure = new URL(cfg.apiUrl).protocol === 'https:';
  const native = sessionCookieName(cfg.projectId, { secure });
  const bridge = appSessionCookieNames(cfg.projectId);
  const names = new Set([native, bridge.secure, bridge.local]);
  return (await nextCookies()).getAll().some((cookie) => names.has(cookie.name));
}
