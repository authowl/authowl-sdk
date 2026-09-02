import type {
  ActionFetchOptions,
  AuthActionResult,
  AuthClientError,
  AuthErrorContext,
  AuthRequestContext,
  AuthResponseContext,
} from './client';
import type { ResolvedAuthConfig } from './config';
import { TransportError, type BoundedJsonResult } from './transport';
import { requestPublishableJson } from './http';
import { CHALLENGE_REJECTED_CODE } from './session-challenge';
import { activeLocale } from './active-locale';

export const AUTH_CHALLENGE_HEADER = 'x-authowl-turnstile-token';
/**
 * The language this request is being conducted in.
 *
 * Advisory: a server that does not know it ignores it, and one that does
 * falls back to the project default for anything it has no catalogue for.
 */
export const AUTH_LOCALE_HEADER = 'x-authowl-locale';
const AUTH_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_DEPTH = 32;
const MAX_RESPONSE_NODES = 20_000;

export type ResponseDecoder<T> = (value: unknown) => T;

export type AuthHttpRequest<T = unknown> = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  fetchOptions?: ActionFetchOptions;
  decode?: ResponseDecoder<T>;
  credentials?: RequestCredentials;
};

export interface AuthHttpClient {
  request<T>(
    path: string,
    options?: AuthHttpRequest<T>,
  ): Promise<AuthActionResult<T>>;
}

export interface AuthActionHelpers {
  post<T>(
    path: string,
    body: unknown,
    fetchOptions?: ActionFetchOptions,
    decode?: ResponseDecoder<T>,
  ): Promise<AuthActionResult<T>>;
  mutation<T>(
    request: Promise<AuthActionResult<T>>,
    shouldNotify?: (data: T) => boolean,
  ): Promise<AuthActionResult<T>>;
}

/** Shared action semantics for POST bodies and successful mutation notification. */
export function createAuthActionHelpers(
  http: AuthHttpClient,
  notifyMutation: () => void | Promise<void>,
): AuthActionHelpers {
  return {
    post: <T>(
      path: string,
      body: unknown,
      fetchOptions?: ActionFetchOptions,
      decode?: ResponseDecoder<T>,
    ) => http.request<T>(path, { method: 'POST', body, fetchOptions, decode }),
    mutation: async <T>(
      request: Promise<AuthActionResult<T>>,
      shouldNotify?: (data: T) => boolean,
    ) => {
      const result = await request;
      if (
        result.error === null
        && (
          shouldNotify === undefined
          || (result.data !== null && shouldNotify(result.data))
        )
      ) {
        await notifyMutation();
      }
      return result;
    },
  };
}

export function createAuthHttpClient(
  config: ResolvedAuthConfig,
  baseURL = config.projectBaseURL,
): AuthHttpClient {
  return {
    async request<T>(
      path: string,
      options: AuthHttpRequest<T> = {},
    ): Promise<AuthActionResult<T>> {
      const url = requestUrl(baseURL, path, options.query);
      const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
      // Endpoint-shaped headers only. The publishable key comes from the shared
      // boundary below and the session from `config.fetch`; this client
      // assembling either of them again is what put the two out of step before.
      const headers = new Headers(options.fetchOptions?.headers);
      if (options.fetchOptions?.authChallengeToken) {
        headers.set(AUTH_CHALLENGE_HEADER, options.fetchOptions.authChallengeToken);
      }
      const locale = activeLocale(config.decoded.projectId);
      if (locale) headers.set(AUTH_LOCALE_HEADER, locale);
      if (options.body !== undefined) headers.set('content-type', 'application/json');

      const init: RequestInit = {
        method,
        headers,
        credentials: options.credentials ?? 'include',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      };
      const requestContext: AuthRequestContext = Object.freeze({ method, path });
      await options.fetchOptions?.onRequest?.(requestContext);

      const attempts = retryAttempts(method, options.fetchOptions);
      let result: BoundedJsonResult;
      try {
        result = await fetchWithRetry(
          config,
          url,
          {
            ...init,
            signal: options.fetchOptions?.signal,
          },
          attempts,
        );
      } catch (cause) {
        const error = networkError(cause);
        await options.fetchOptions?.onError?.(
          errorContext(requestContext, error, failureCategory(cause)),
        );
        return { data: null, error };
      }

      const { response, requestId } = result;
      const payload = projectBrowserAuthPayload(path, result.data);
      let revivedPayload = payload;
      if (response.ok) {
        try {
          revivedPayload = reviveDates(payload);
          if (options.decode) revivedPayload = options.decode(revivedPayload);
        } catch {
          const error = networkError(new TransportError('invalid_response', requestId));
          await options.fetchOptions?.onError?.(
            errorContext(requestContext, error, 'invalid_response'),
          );
          return { data: null, error };
        }
      }
      const responseContext: AuthResponseContext = Object.freeze({
        ...requestContext,
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
      });
      await options.fetchOptions?.onResponse?.(responseContext);

      if (!response.ok) {
        const error = responseError(response, payload, requestId);
        // The engine says the challenge we presented is spent, expired, or was
        // never there. Drop it, or every later request carries a dead ticket and
        // a `dont_remember` that describes nothing, for as long as the tab lives.
        //
        // HERE, keyed on the CODE, rather than wrapped around the 2FA verifies.
        // `/two-factor/send-otp` reads the ticket too - it is how the email-OTP
        // recovery factor is requested - and so will whatever is added next. This
        // SDK's recurring defect is wiring one request path and missing the
        // parallel one, three times on this track alone, and a list of the
        // endpoints that read a ticket is that defect with a different spelling.
        // Nothing else in the SDK issues this code, and dropping a store that is
        // already empty is a no-op, so the breadth costs nothing.
        if (error.code === CHALLENGE_REJECTED_CODE) config.session.tokens.dropChallenge();
        await options.fetchOptions?.onError?.(errorContext(requestContext, error, 'api'));
        return { data: null, error };
      }

      await options.fetchOptions?.onSuccess?.(responseContext);
      return { data: revivedPayload as T, error: null };
    },
  };
}

async function fetchWithRetry(
  config: ResolvedAuthConfig,
  url: string,
  init: RequestInit,
  attempts: number,
): Promise<BoundedJsonResult> {
  const deadline = Date.now() + AUTH_REQUEST_TIMEOUT_MS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new TransportError('timeout');
    try {
      const result = await requestPublishableJson(config, url, {
        init,
        timeoutMs: Math.max(1, Math.ceil(remainingMs)),
      });
      if (result.response.status < 500 || attempt === attempts - 1) return result;
    } catch (error) {
      if (
        attempt === attempts - 1
        || !(error instanceof TransportError)
        || error.kind !== 'network'
      ) {
        throw error;
      }
    }
    await retryDelay(50 * 2 ** attempt, init.signal, deadline);
  }
  throw new TransportError('network');
}

function retryAttempts(
  method: 'GET' | 'POST' | 'PATCH',
  options: ActionFetchOptions | undefined,
): number {
  // Generic mutation replay is unsafe after an ambiguous network failure. A
  // mutation may retry only in an endpoint-owned adapter with a server-enforced
  // idempotency contract. Turnstile challenges are also single-use.
  if (method !== 'GET' || options?.authChallengeToken) return 1;
  const requested = options?.retry;
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return 1;
  return Math.min(Math.max(Math.trunc(requested), 0), 3) + 1;
}

function requestUrl(
  baseURL: string,
  path: string,
  query: AuthHttpRequest<unknown>['query'],
): string {
  const url = new URL(`${baseURL}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function responseError(
  response: Response,
  payload: unknown,
  requestId: string | undefined,
): AuthClientError {
  const body = isRecord(payload) ? payload : {};
  const retryAfterSeconds = parseRetryAfterSeconds(body, response.headers);
  return {
    status: response.status,
    statusText: response.statusText,
    code: typeof body.code === 'string' ? body.code : undefined,
    ...(requestId === undefined ? {} : { requestId }),
    ...(typeof body.current_version === 'number'
      ? { currentVersion: body.current_version }
      : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    message:
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : typeof body.detail === 'string'
            ? body.detail
          : response.statusText || 'Request failed',
  };
}

/**
 * Wait-before-retry hint for rate-limit / lockout responses. The body's
 * `retryAfterSeconds` field wins (survives header-stripping proxies); otherwise
 * the `Retry-After` / `X-Retry-After` header in delta-seconds form (the HTTP-date
 * form is ignored - the drop-in only needs a relative countdown). Clamped to a
 * sane [1, 86400] integer so a malformed value can't drive a bogus timer.
 */
function parseRetryAfterSeconds(
  body: Record<string, unknown>,
  headers: Headers,
): number | undefined {
  const raw =
    (typeof body.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds)
      ? body.retryAfterSeconds
      : undefined) ??
    headerSeconds(headers.get('retry-after')) ??
    headerSeconds(headers.get('x-retry-after'));
  if (raw === undefined) return undefined;
  return Math.min(Math.max(Math.trunc(raw), 1), 86400);
}

/** Parse a header's delta-seconds integer, ignoring the HTTP-date form. */
function headerSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function networkError(cause: unknown): AuthClientError {
  const kind = cause instanceof TransportError ? cause.kind : 'network';
  const details = {
    aborted: {
      statusText: 'ABORTED',
      code: 'REQUEST_ABORTED',
      message: 'The request was cancelled.',
    },
    timeout: {
      statusText: 'TIMEOUT',
      code: 'REQUEST_TIMEOUT',
      message: 'The request timed out.',
    },
    response_too_large: {
      statusText: 'INVALID_RESPONSE',
      code: 'RESPONSE_TOO_LARGE',
      message: 'The service response was too large.',
    },
    invalid_response: {
      statusText: 'INVALID_RESPONSE',
      code: 'INVALID_RESPONSE',
      message: 'The service returned an invalid response.',
    },
    network: {
      statusText: 'FETCH_ERROR',
      code: 'FETCH_ERROR',
      message: 'Network request failed.',
    },
  }[kind];
  return {
    status: 0,
    ...details,
    ...(cause instanceof TransportError && cause.requestId
      ? { requestId: cause.requestId }
      : {}),
  };
}

function errorContext(
  request: AuthRequestContext,
  error: AuthClientError,
  failure: AuthErrorContext['failure'],
): AuthErrorContext {
  return Object.freeze({
    ...request,
    status: error.status ?? 0,
    ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    failure,
  });
}

function failureCategory(cause: unknown): AuthErrorContext['failure'] {
  return cause instanceof TransportError ? cause.kind : 'network';
}

function retryDelay(
  ms: number,
  signal: AbortSignal | null | undefined,
  deadline: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TransportError('aborted'));
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      reject(new TransportError('timeout'));
      return;
    }
    const delayMs = Math.min(ms, remainingMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new TransportError('aborted'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      if (Date.now() >= deadline) reject(new TransportError('timeout'));
      else resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function reviveDates(
  value: unknown,
  key = '',
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): unknown {
  budget.nodes += 1;
  if (depth > MAX_RESPONSE_DEPTH || budget.nodes > MAX_RESPONSE_NODES) {
    throw new Error('response traversal limit exceeded');
  }
  if (typeof value === 'string' && /^(?:createdAt|updatedAt|expiresAt)$/.test(key)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (Array.isArray(value)) {
    return value.map((item) => reviveDates(item, '', depth + 1, budget));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        isMetadataField(childKey)
          ? child
          : reviveDates(child, childKey, depth + 1, budget),
      ]),
    );
  }
  return value;
}

function isMetadataField(key: string): boolean {
  return (
    key === 'metadata'
    || key === 'public_metadata'
    || key === 'unsafe_metadata'
    || key === 'private_metadata'
    || key === 'publicMetadata'
    || key === 'unsafeMetadata'
    || key === 'privateMetadata'
  );
}

/**
 * Remove the engine's durable session token from exact browser response
 * families. This remains narrow enough to preserve reset/delete inputs and the
 * separate short-lived `/token` JWT.
 */
export function projectBrowserAuthPayload(path: string, payload: unknown): unknown {
  if (path === '/list-sessions' && Array.isArray(payload)) {
    return payload.map((session) =>
      isRecord(session) ? withoutToken(session) : session,
    );
  }
  if (!isRecord(payload)) return payload;

  const stripsTopLevelToken =
    path === '/change-password' ||
    path === '/passkey/verify-authentication' ||
    path === '/phone-otp/verify' ||
    path === '/sign-up/email' ||
    path.startsWith('/sign-in/') ||
    path.startsWith('/two-factor/verify-');
  let projected = stripsTopLevelToken ? withoutToken(payload) : payload;

  if (path === '/sign-up/email' && !('sessionCreated' in projected)) {
    projected = {
      ...projected,
      sessionCreated:
        typeof payload.token === 'string' && payload.token.length > 0,
    };
  }

  if (
    (path === '/get-session' || path === '/passkey/verify-authentication') &&
    isRecord(projected.session)
  ) {
    projected = { ...projected, session: withoutToken(projected.session) };
  }
  return projected;
}

function withoutToken(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (!Object.hasOwn(value, 'token')) return value;
  const projected = { ...value };
  delete projected.token;
  return projected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
