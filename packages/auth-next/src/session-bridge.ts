import {
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
} from '@authowl/core/server';
import {
  APP_SESSION_BRIDGE_CODE_MAX_LENGTH,
  APP_SESSION_BRIDGE_HEADER,
  AUTHOWL_SECRET_KEY_HEADER,
  appSessionCookieNames,
} from './bridge-contract';
import {
  getAuthConfig,
  resolveAuthConfig,
  type AuthOwlNextServerConfig,
  type ServerAuthConfig,
} from './server-config';
const MAX_BODY_BYTES = 16_384;
const AUTH_FETCH_TIMEOUT_MS = 10_000;

export type AuthOwlSessionBridgeOptions = Omit<AuthOwlNextServerConfig, 'secretKey'> & Readonly<{
  secretKey: string;
}>;

type ConfiguredBridgeConfig = ServerAuthConfig & Readonly<{ secretKey: string }>;

type SessionEnvelope = {
  user?: unknown;
  session?: {
    expiresAt?: unknown;
    pendingMfaEnrollment?: unknown;
  };
};

function response(status: number, body?: Readonly<Record<string, string>>): Response {
  return body
    ? Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
    : new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

function singleForwardingHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (!value || value !== value.trim() || value.includes(',')) return null;
  return value;
}

function forwardedRequestOrigin(request: Request): string | null {
  const protocol = singleForwardingHeader(request.headers, 'x-forwarded-proto');
  const host =
    singleForwardingHeader(request.headers, 'x-forwarded-host') ??
    singleForwardingHeader(request.headers, 'host');
  if ((protocol !== 'http' && protocol !== 'https') || !host) return null;

  try {
    const url = new URL(`${protocol}://${host}`);
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function sameOriginBrowserPostOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const requestOrigin = new URL(request.url).origin;
  if (
    request.method !== 'POST' ||
    origin === null ||
    (site !== null && site !== 'same-origin') ||
    request.headers.get(APP_SESSION_BRIDGE_HEADER) !== '1' ||
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json'
  ) {
    return null;
  }
  if (origin === requestOrigin) return requestOrigin;
  return origin === forwardedRequestOrigin(request) ? origin : null;
}

function validToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8_192 &&
    /^[\u0021-\u007e]+$/.test(value) &&
    !/[",;\\]/.test(value)
  );
}

function futureExpiry(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const expires = new Date(value);
  return Number.isFinite(expires.getTime()) && expires.getTime() > Date.now()
    ? expires
    : null;
}

function serializeCookie(
  name: string,
  value: string,
  options: { secure: boolean; expires?: Date; clear?: boolean },
): string {
  const attributes = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) attributes.push('Secure');
  if (options.clear) attributes.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  else if (options.expires) attributes.push(`Expires=${options.expires.toUTCString()}`);
  return attributes.join('; ');
}

function clearCookies(projectId: string): Response {
  const names = appSessionCookieNames(projectId);
  const result = response(204);
  result.headers.append('set-cookie', serializeCookie(names.secure, '', { secure: true, clear: true }));
  result.headers.append('set-cookie', serializeCookie(names.local, '', { secure: false, clear: true }));
  return result;
}

type RedeemOutcome =
  | { kind: 'ok'; response: Response }
  | { kind: 'invalid_code' }
  | { kind: 'bridge_misconfigured' }
  | { kind: 'auth_service_unavailable' }
  | { kind: 'auth_service_error' };

type GetSessionOutcome =
  | { kind: 'ok'; response: Response }
  | { kind: 'invalid_session' }
  | { kind: 'auth_service_unavailable' }
  | { kind: 'auth_service_error' };

function configuredBridge(config: ServerAuthConfig): ConfiguredBridgeConfig | null {
  return config.secretKey ? { ...config, secretKey: config.secretKey } : null;
}

function requireConfiguredBridge(config: ServerAuthConfig): ConfiguredBridgeConfig {
  const configured = configuredBridge(config);
  if (configured) return configured;
  throw new Error(
    'AuthOwl session bridge is not configured. Set AUTHOWL_SECRET_KEY or pass secretKey to createAuthOwlSessionBridge().',
  );
}

async function redeemBridgeCode(
  remoteFetch: typeof fetch,
  config: ConfiguredBridgeConfig,
  code: string,
): Promise<RedeemOutcome> {
  let upstream: Response;
  try {
    upstream = await remoteFetch(`${config.apiUrl}/api/v1/sessions/bridge-code`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
      body: JSON.stringify({ code }),
    });
  } catch {
    return { kind: 'auth_service_unavailable' };
  }
  if (upstream.status === 422) return { kind: 'invalid_code' };
  if (upstream.status === 401 || upstream.status === 403) {
    return { kind: 'bridge_misconfigured' };
  }
  if (upstream.status >= 500) return { kind: 'auth_service_unavailable' };
  if (!upstream.ok) return { kind: 'auth_service_error' };
  return { kind: 'ok', response: upstream };
}

async function validateSession(
  remoteFetch: typeof fetch,
  config: ConfiguredBridgeConfig,
  token: string,
): Promise<GetSessionOutcome> {
  let upstream: Response;
  try {
    upstream = await remoteFetch(
      `${config.apiUrl}/api/projects/${config.projectId}/auth/get-session`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          [SESSION_TRANSPORT_HEADER]: SESSION_TRANSPORT_BEARER,
          [AUTHOWL_SECRET_KEY_HEADER]: config.secretKey,
          'x-publishable-key': config.publishableKey,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
      },
    );
  } catch {
    return { kind: 'auth_service_unavailable' };
  }
  if (upstream.status === 401) return { kind: 'invalid_session' };
  if (!upstream.ok) return { kind: 'auth_service_error' };
  return { kind: 'ok', response: upstream };
}

/**
 * Build the same-origin endpoint that projects an AuthOwl browser session into
 * an application-owned HttpOnly cookie. The browser supplies only a single-use
 * code; the secret-bearing app route redeems and validates the session token.
 */
export function createAuthOwlSessionBridge(input?: AuthOwlSessionBridgeOptions) {
  const configured = input ? requireConfiguredBridge(resolveAuthConfig(input)) : null;
  const remoteFetch = input?.fetch ?? globalThis.fetch;
  let deferredConfig: ConfiguredBridgeConfig | null | undefined;

  const configForRequest = (): ConfiguredBridgeConfig | null => {
    if (configured) return configured;
    if (deferredConfig !== undefined) return deferredConfig;
    try {
      deferredConfig = configuredBridge(getAuthConfig());
    } catch {
      deferredConfig = null;
    }
    return deferredConfig;
  };

  return async function authOwlSessionBridge(request: Request): Promise<Response> {
    const browserOrigin = sameOriginBrowserPostOrigin(request);
    if (!browserOrigin) {
      return response(403, { error: 'forbidden' });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return response(413, { error: 'payload_too_large' });

    let body: { code?: unknown; token?: unknown; remember?: unknown };
    try {
      body = JSON.parse(raw) as { code?: unknown; token?: unknown; remember?: unknown };
    } catch {
      return response(400, { error: 'invalid_request' });
    }

    let action:
      | { kind: 'clear' }
      | { kind: 'bridge'; code: string; remember: boolean | undefined };
    if (body.token === null) {
      action = { kind: 'clear' };
    } else {
      if (
        typeof body.code !== 'string'
        || body.code.length > APP_SESSION_BRIDGE_CODE_MAX_LENGTH
        || (body.remember !== undefined && typeof body.remember !== 'boolean')
      ) {
        return response(400, { error: 'invalid_request' });
      }
      action = { kind: 'bridge', code: body.code, remember: body.remember };
    }

    const config = configForRequest();
    if (!config) {
      // Deferred env configuration is resolved once on the first valid bridge
      // request. Latching the deployment failure makes every caller see the
      // same explicit diagnosis instead of a per-request throw or silent clear.
      return response(503, { error: 'bridge_misconfigured' });
    }
    if (action.kind === 'clear') return clearCookies(config.projectId);

    const redeemedResult = await redeemBridgeCode(remoteFetch, config, action.code);
    if (redeemedResult.kind === 'invalid_code') {
      return response(401, { error: 'invalid_session' });
    }
    if (redeemedResult.kind === 'bridge_misconfigured') {
      return response(503, { error: 'bridge_misconfigured' });
    }
    if (redeemedResult.kind === 'auth_service_unavailable') {
      return response(503, { error: 'auth_service_unavailable' });
    }
    if (redeemedResult.kind === 'auth_service_error') {
      return response(502, { error: 'auth_service_error' });
    }
    const redeemedResponse = redeemedResult.response;

    let redeemed: { token?: unknown; expiresAt?: unknown };
    try {
      redeemed = await redeemedResponse.json() as { token?: unknown; expiresAt?: unknown };
    } catch {
      return response(502, { error: 'invalid_auth_response' });
    }
    const redeemedExpiry = futureExpiry(redeemed.expiresAt);
    if (!validToken(redeemed.token) || !redeemedExpiry) {
      return response(502, { error: 'invalid_auth_response' });
    }

    const sessionResult = await validateSession(remoteFetch, config, redeemed.token);
    if (sessionResult.kind === 'invalid_session') {
      return response(401, { error: 'invalid_session' });
    }
    if (sessionResult.kind === 'auth_service_unavailable') {
      return response(503, { error: 'auth_service_unavailable' });
    }
    if (sessionResult.kind === 'auth_service_error') {
      return response(502, { error: 'auth_service_error' });
    }
    const sessionResponse = sessionResult.response;

    let session: SessionEnvelope | null;
    try {
      session = (await sessionResponse.json()) as SessionEnvelope | null;
    } catch {
      return response(502, { error: 'invalid_auth_response' });
    }
    if (!session?.user || !session.session || session.session.pendingMfaEnrollment === true) {
      return response(401, { error: 'invalid_session' });
    }

    const sessionExpiry = futureExpiry(session.session.expiresAt);
    if (!sessionExpiry) return response(401, { error: 'invalid_session' });

    const secure = new URL(browserOrigin).protocol === 'https:';
    const names = appSessionCookieNames(config.projectId);
    const result = response(204);
    result.headers.append(
      'set-cookie',
      serializeCookie(secure ? names.secure : names.local, redeemed.token, {
        secure,
        // Both values describe the same session. Taking the earlier one keeps a
        // malformed upstream response from extending the app cookie past either
        // authority's stated lifetime.
        expires: action.remember === false
          ? undefined
          : new Date(Math.min(redeemedExpiry.getTime(), sessionExpiry.getTime())),
      }),
    );
    return result;
  };
}
