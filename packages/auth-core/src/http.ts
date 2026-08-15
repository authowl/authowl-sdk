import type { ResolvedAuthConfig } from './config';
import {
  requestBoundedJson,
  type BoundedJsonResult,
  type ResponseDecoder,
} from './transport';

/** Stable, secret-safe non-2xx failure for project JSON endpoints. */
export class AuthOwlHttpError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(label: string, response: Response, requestId?: string) {
    super(`${label} request failed with status ${response.status}.`);
    this.name = 'AuthOwlHttpError';
    this.status = response.status;
    this.requestId = requestId;
  }
}

type PublishableJsonRequest<T> = {
  init?: RequestInit;
  timeoutMs?: number;
  maxResponseBytes?: number;
  decode?: ResponseDecoder<T>;
};

/**
 * Shared bounded transport for publishable-key project endpoints - the ONE door
 * for anything this SDK sends on a user's behalf.
 *
 * Status meaning and endpoint schemas remain call-site owned. This boundary
 * owns key/header injection plus HTTPS, redirects, timeout, abort, body,
 * media-type, request-id, and secret-redaction mechanics. The session rides
 * `config.fetch` rather than being assembled here, so a caller that reaches past
 * this function still cannot lose it.
 */
export function requestPublishableJson<T = unknown>(
  config: ResolvedAuthConfig,
  url: string | URL,
  options: PublishableJsonRequest<T> = {},
): Promise<BoundedJsonResult<T>> {
  const headers = new Headers(options.init?.headers);
  headers.set('x-publishable-key', config.publishableKey);
  return requestBoundedJson({
    fetchImpl: config.fetch,
    url,
    init: {
      ...options.init,
      headers,
    },
    allowHttpLoopback: config.decoded.env === 'test',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
    ...(options.decode === undefined ? {} : { decode: options.decode }),
  });
}

/** Require success while preserving only safe response metadata. */
export function requireOk<T>(
  result: BoundedJsonResult<T>,
  label: string,
): T {
  if (!result.response.ok) {
    throw new AuthOwlHttpError(label, result.response, result.requestId);
  }
  return result.data;
}
