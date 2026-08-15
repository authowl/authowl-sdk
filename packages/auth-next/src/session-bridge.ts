import {
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
  type AuthConfig,
} from '@authowl/core/server';
import {
  APP_SESSION_BRIDGE_HEADER,
  appSessionCookieNames,
} from './bridge-contract';
import { getAuthConfig, resolveAuthConfig } from './server-config';
const MAX_BODY_BYTES = 16_384;
const AUTH_FETCH_TIMEOUT_MS = 10_000;

export type AuthOwlSessionBridgeOptions = AuthConfig;

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

/**
 * Build the same-origin endpoint that projects an AuthOwl browser session into
 * an application-owned HttpOnly cookie. The token is accepted only after the
 * AuthOwl project validates it as a completed, live session.
 */
export function createAuthOwlSessionBridge(input?: AuthOwlSessionBridgeOptions) {
  const configured = input ? resolveAuthConfig(input) : null;
  const remoteFetch = input?.fetch ?? globalThis.fetch;

  return async function authOwlSessionBridge(request: Request): Promise<Response> {
    const config = configured ?? getAuthConfig();
    const projectId = config.projectId;
    const browserOrigin = sameOriginBrowserPostOrigin(request);
    if (!browserOrigin) {
      return response(403, { error: 'forbidden' });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return response(413, { error: 'payload_too_large' });

    let body: { token?: unknown; remember?: unknown };
    try {
      body = JSON.parse(raw) as { token?: unknown; remember?: unknown };
    } catch {
      return response(400, { error: 'invalid_request' });
    }

    if (body.token === null) return clearCookies(projectId);
    if (!validToken(body.token) || (body.remember !== undefined && typeof body.remember !== 'boolean')) {
      return response(400, { error: 'invalid_request' });
    }

    let sessionResponse: Response;
    try {
      sessionResponse = await remoteFetch(
        `${config.apiUrl}/api/projects/${projectId}/auth/get-session`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${body.token}`,
            [SESSION_TRANSPORT_HEADER]: SESSION_TRANSPORT_BEARER,
            'x-publishable-key': config.publishableKey,
          },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
        },
      );
    } catch {
      return response(503, { error: 'auth_service_unavailable' });
    }

    if (sessionResponse.status === 401) return response(401, { error: 'invalid_session' });
    if (!sessionResponse.ok) return response(502, { error: 'auth_service_error' });

    let session: SessionEnvelope | null;
    try {
      session = (await sessionResponse.json()) as SessionEnvelope | null;
    } catch {
      return response(502, { error: 'invalid_auth_response' });
    }
    if (!session?.user || !session.session || session.session.pendingMfaEnrollment === true) {
      return response(401, { error: 'invalid_session' });
    }

    if (typeof session.session.expiresAt !== 'string') {
      return response(401, { error: 'invalid_session' });
    }
    const expires = new Date(session.session.expiresAt);
    if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) {
      return response(401, { error: 'invalid_session' });
    }

    const secure = new URL(browserOrigin).protocol === 'https:';
    const names = appSessionCookieNames(projectId);
    const result = response(204);
    result.headers.append(
      'set-cookie',
      serializeCookie(secure ? names.secure : names.local, body.token, {
        secure,
        expires: body.remember === false ? undefined : expires,
      }),
    );
    return result;
  };
}
