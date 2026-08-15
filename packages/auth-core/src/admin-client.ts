import type { components, operations } from './admin-api.generated';
import { adminOperations, type AdminOperationId } from './admin-operations.generated';
import { decodeAdminOperationResponse } from './admin-response-validator';
import {
  requestBoundedJson,
  withoutSessionTransport,
  TransportError,
  type BoundedJsonResult,
  type TransportErrorKind,
} from './transport';
import { canonicalTransportUrl } from './url-policy';

const SECRET_KEY_PATTERN = /^sk_(?:live|test)_[0-9a-f-]{36}_[A-Za-z0-9]{20,}$/i;
const ADMIN_RESPONSE_MAX_BYTES = 1024 * 1024;
const ADMIN_REQUEST_TIMEOUT_MS = 10_000;

type Operation = operations[AdminOperationId];
type ParameterKind = 'query' | 'path' | 'header';

type ParameterInput<O extends Operation, K extends ParameterKind> = O extends {
  parameters: infer P;
}
  ? K extends keyof P
    ? [NonNullable<P[K]>] extends [never]
      ? object
      : undefined extends P[K]
        ? { [Field in K]?: NonNullable<P[K]> }
        : { [Field in K]: P[K] }
    : object
  : object;

type BodyInput<O extends Operation> = O extends { requestBody: infer B }
  ? B extends { content: { 'application/json': infer Body } }
    ? { body: Body }
    : object
  : O extends { requestBody?: infer B }
    ? B extends { content: { 'application/json': infer Body } }
      ? { body?: Body }
      : object
    : object;

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;
type SuccessResponse<O extends Operation> = O extends { responses: infer Responses }
  ? { [Status in keyof Responses]: Status extends SuccessStatus ? Responses[Status] : never }[keyof Responses]
  : never;
type ResponseBody<Response> = Response extends { content: infer Content }
  ? Content extends { 'application/json': infer Body }
    ? Body
    : void
  : void;

type Simplify<T> = { [K in keyof T]: T[K] } & object;

export type AdminOperationInput<Id extends AdminOperationId> = Simplify<
  ParameterInput<operations[Id], 'path'> &
    ParameterInput<operations[Id], 'query'> &
    ParameterInput<operations[Id], 'header'> &
    BodyInput<operations[Id]> & { signal?: AbortSignal }
>;

export type AdminOperationResult<Id extends AdminOperationId> = ResponseBody<
  SuccessResponse<operations[Id]>
>;

type AdminMethod<Id extends AdminOperationId> = object extends AdminOperationInput<Id>
  ? (input?: AdminOperationInput<Id>) => Promise<AdminOperationResult<Id>>
  : (input: AdminOperationInput<Id>) => Promise<AdminOperationResult<Id>>;

export type AdminClient = {
  readonly [Id in AdminOperationId]: AdminMethod<Id>;
} & {
  readonly request: <Id extends AdminOperationId>(
    operationId: Id,
    ...args: object extends AdminOperationInput<Id>
      ? [input?: AdminOperationInput<Id>]
      : [input: AdminOperationInput<Id>]
  ) => Promise<AdminOperationResult<Id>>;
};

export type AdminClientConfig = {
  /** AuthOwl server-side secret key. Never expose this value to browser code. */
  secretKey: string;
  /** AuthOwl deployment origin, with an optional trailing `/api/v1`. */
  apiUrl: string;
  /** Custom fetch implementation for server runtimes and tests. */
  fetch?: typeof fetch;
};

export type AdminApiProblem = components['schemas']['Problem'];

export class AuthOwlAdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly problem: AdminApiProblem;
  readonly retryAfter?: string;

  constructor(input: {
    status: number;
    code: string;
    requestId?: string;
    problem: AdminApiProblem;
    retryAfter?: string;
  }) {
    super(input.problem.detail);
    this.name = 'AuthOwlAdminApiError';
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    this.problem = input.problem;
    this.retryAfter = input.retryAfter;
  }
}

export class AuthOwlAdminNetworkError extends Error {
  readonly kind: TransportErrorKind;
  readonly requestId?: string;

  constructor(kind: TransportErrorKind, requestId?: string) {
    super(
      kind === 'aborted'
        ? 'The AuthOwl Admin API request was aborted.'
        : kind === 'timeout'
          ? 'The AuthOwl Admin API request timed out.'
          : kind === 'response_too_large'
            ? 'The AuthOwl Admin API response exceeded the allowed size.'
        : kind === 'invalid_response'
          ? 'The AuthOwl Admin API returned an invalid response.'
          : 'The AuthOwl Admin API request could not be completed.',
    );
    this.name = 'AuthOwlAdminNetworkError';
    this.kind = kind;
    this.requestId = requestId;
  }
}

export function createAdminClient(input: AdminClientConfig): AdminClient {
  assertServerRuntime();
  const secretKey = validateSecretKey(input?.secretKey);
  const baseUrl = resolveBaseUrl(input?.apiUrl);
  const provided = input?.fetch ?? globalThis.fetch;
  if (typeof provided !== 'function') {
    throw new TypeError('A fetch implementation is required in this server runtime.');
  }
  // No session, deliberately: `Authorization` here carries the project's SECRET
  // key, and a browser session token has neither a place to go nor any business
  // in a server-only client.
  const fetchImpl = withoutSessionTransport(provided);

  const request = async <Id extends AdminOperationId>(
    operationId: Id,
    operationInput?: AdminOperationInput<Id>,
  ): Promise<AdminOperationResult<Id>> => {
    const normalizedInput = operationInput ?? {};
    const operation = adminOperations[operationId];
    const url = new URL(buildPath(operation.path, normalizedInput).replace(/^\/+/, ''), baseUrl);
    appendQuery(url, normalizedInput);

    const headers = new Headers({
      accept: 'application/json, application/problem+json',
      authorization: `Bearer ${secretKey}`,
    });
    appendOperationHeaders(headers, normalizedInput);
    const body = 'body' in normalizedInput ? JSON.stringify(normalizedInput.body) : undefined;
    if (body !== undefined) headers.set('content-type', 'application/json');

    let result: BoundedJsonResult<unknown>;
    try {
      result = await requestBoundedJson({
        fetchImpl,
        url,
        init: {
          method: operation.method,
          headers,
          body,
          signal: operationInput?.signal,
        },
        timeoutMs: ADMIN_REQUEST_TIMEOUT_MS,
        maxResponseBytes: ADMIN_RESPONSE_MAX_BYTES,
        allowHttpLoopback: baseUrl.protocol === 'http:',
        decode: (value, context) =>
          decodeAdminOperationResponse(operationId, context.status, value),
      });
    } catch (error) {
      if (error instanceof AuthOwlAdminApiError) throw error;
      if (error instanceof TransportError) {
        throw new AuthOwlAdminNetworkError(error.kind, error.requestId);
      }
      throw new AuthOwlAdminNetworkError('network');
    }

    const { response, requestId, data } = result;
    if (!response.ok) throw toApiError(response, data, requestId);
    if (!operation.successStatuses.some((status) => status === response.status)) {
      throw new AuthOwlAdminNetworkError('invalid_response', requestId);
    }
    return data as AdminOperationResult<Id>;
  };

  const client: Record<string, unknown> = Object.assign(Object.create(null), { request });
  for (const operationId of Object.keys(adminOperations) as AdminOperationId[]) {
    client[operationId] = (operationInput?: AdminOperationInput<typeof operationId>) =>
      request(operationId, operationInput);
  }
  return Object.freeze(client) as AdminClient;
}

function assertServerRuntime(): void {
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    throw new Error('createAdminClient must not be called in a browser context.');
  }
}

function validateSecretKey(secretKey: string | undefined): string {
  if (typeof secretKey !== 'string' || !SECRET_KEY_PATTERN.test(secretKey)) {
    throw new TypeError('secretKey is malformed; expected sk_(live|test)_<uuid>_<random>.');
  }
  return secretKey;
}

function resolveBaseUrl(apiUrl: string | undefined): URL {
  if (typeof apiUrl !== 'string' || apiUrl.length === 0) throw new TypeError('apiUrl is required.');

  const url = canonicalTransportUrl(apiUrl, { allowHttpLoopback: true });
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('apiUrl must not contain credentials, a query, or a fragment.');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname !== '' && pathname !== '/api/v1') {
    throw new TypeError('apiUrl path must be empty or /api/v1.');
  }
  url.pathname = '/api/v1/';
  return url;
}

function buildPath(template: string, input: object): string {
  const pathValues = 'path' in input && isRecord(input.path) ? input.path : {};
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = pathValues[name];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`Missing Admin API path parameter: ${name}.`);
    }
    return encodeURIComponent(String(value));
  });
}

function appendQuery(url: URL, input: object): void {
  if (!('query' in input) || !isRecord(input.query)) return;
  for (const [name, rawValue] of Object.entries(input.query)) {
    if (rawValue === undefined || rawValue === null) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) url.searchParams.append(name, String(value));
  }
}

/**
 * Forward only headers declared by the generated operation contract. The
 * current public contract uses this for Idempotency-Key. Authentication and
 * representation headers remain owned by the SDK and cannot be overridden.
 */
function appendOperationHeaders(headers: Headers, input: object): void {
  if (!('header' in input) || !isRecord(input.header)) return;
  for (const [name, rawValue] of Object.entries(input.header)) {
    if (rawValue === undefined || rawValue === null) continue;
    const normalizedName = name.toLowerCase();
    if (normalizedName !== 'idempotency-key') {
      throw new TypeError(`Unsupported Admin API header parameter: ${name}.`);
    }
    if (typeof rawValue !== 'string' || rawValue.length < 1 || rawValue.length > 255) {
      throw new TypeError('Idempotency-Key must contain between 1 and 255 characters.');
    }
    if (!/^[\x21-\x7e ]+$/.test(rawValue)) {
      throw new TypeError('Idempotency-Key contains unsupported characters.');
    }
    headers.set('Idempotency-Key', rawValue);
  }
}

function toApiError(
  response: Response,
  data: unknown,
  transportRequestId: string | undefined,
): AuthOwlAdminApiError {
  const requestId =
    transportRequestId ?? safeHeader(response.headers.get('x-request-id'), 256);
  const retryAfter = safeHeader(response.headers.get('retry-after'), 128);
  const fallback = fallbackProblem(response.status, requestId);
  const problem = isProblem(data) ? data : fallback;

  return new AuthOwlAdminApiError({
    status: response.status,
    code: problem.code,
    requestId,
    problem,
    retryAfter,
  });
}

function fallbackProblem(status: number, requestId?: string): AdminApiProblem {
  const id = requestId ?? 'unknown';
  return {
    type: 'about:blank',
    title: 'AuthOwl Admin API error',
    status,
    detail: 'The AuthOwl Admin API rejected the request.',
    instance: `urn:authowl:request:${id}`,
    code: 'UNKNOWN_ERROR',
  };
}

function isProblem(value: unknown): value is AdminApiProblem {
  if (!isRecord(value)) return false;
  return (
    typeof value.type === 'string' &&
    typeof value.title === 'string' &&
    typeof value.status === 'number' &&
    typeof value.detail === 'string' &&
    typeof value.instance === 'string' &&
    typeof value.code === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeHeader(value: string | null, maxLength: number): string | undefined {
  const normalized = value?.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || !/^[\x21-\x7e]+$/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}
