import type { ResolvedAuthConfig } from './config';
import { requestPublishableJson } from './http';

export const CLIENT_EXTENSION_KEY: unique symbol = Symbol.for(
  'authowl.core.client-extension.v1',
) as never;

type ProjectJsonRequestBase<T> = Readonly<{
  timeoutMs: number;
  maxResponseBytes: number;
  decode: (value: unknown) => T;
  signal?: AbortSignal;
}>;

export type ProjectJsonRequest<T> = ProjectJsonRequestBase<T> & (
  | Readonly<{ method: 'GET'; body?: never }>
  | Readonly<{ method: 'POST'; body: unknown }>
);

export type ProjectJsonResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{
    ok: false;
    status: number;
    code: string | null;
    requestId: string | null;
    retryAfterSeconds: number | null;
  }>;

/**
 * Versioned project request seam for AuthOwl sibling packages.
 *
 * The global symbol lets a second installed copy of core use the app client's
 * bound transport and bearer store. Auth paths are refused, and non-2xx bodies
 * expose only bounded safe metadata.
 */
export type ClientExtension = Readonly<{
  version: 1;
  requestProjectJson<T>(
    path: string,
    request: ProjectJsonRequest<T>,
  ): Promise<ProjectJsonResult<T>>;
}>;

const PROJECT_PATH = /^\/(?!auth(?:\/|$))[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const UPGRADE_ERROR =
  'This AuthOwl client has no extension support. Upgrade @authowl/react and @authowl/core.';

export function attachClientExtension(
  client: object,
  config: ResolvedAuthConfig,
): void {
  const requestConfig = {
    ...config,
    fetch: ((
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => config.fetch(input, init).then((response) => (
      response.ok || !response.body ? response : boundErrorBody(response)
    ))) as ResolvedAuthConfig['fetch'],
  };
  const value: ClientExtension = Object.freeze({
    version: 1,
    async requestProjectJson<T>(
      path: string,
      request: ProjectJsonRequest<T>,
    ): Promise<ProjectJsonResult<T>> {
      if (!PROJECT_PATH.test(path)) {
        throw new TypeError('Project request path is invalid.');
      }
      if (request.method !== 'GET' && request.method !== 'POST') {
        throw new TypeError('Project request method is invalid.');
      }
      const result = await requestPublishableJson(
        requestConfig,
        `${config.apiUrl}/api/projects/${config.decoded.projectId}${path}`,
        {
        init: {
          method: request.method,
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: request.signal,
        },
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes,
        decode: (input) => request.decode(input),
        },
      );
      const response = result.response;
      if (response.ok) return Object.freeze({ ok: true, data: result.data });
      const retryAfter = response.headers.get('retry-after');
      return Object.freeze({
        ok: false,
        status: response.status,
        code: matchingString(
          (result.data as { code?: unknown } | null)?.code,
          /^[A-Z][A-Z0-9_]{0,39}$/,
        ),
        requestId: matchingString(result.requestId, /^[A-Za-z0-9_.-]{1,64}$/),
        retryAfterSeconds: /^\d+$/.test(retryAfter ?? '')
          ? Math.min(Math.max(Number(retryAfter), 1), 86_400)
          : null,
      });
    },
  });
  Object.defineProperty(client, CLIENT_EXTENSION_KEY, {
    value,
  });
}

/**
 * Read the version 1 sibling-package seam or throw the core upgrade error.
 */
export function clientExtension(client: unknown): ClientExtension {
  const value = (Object(client) as Record<PropertyKey, { version?: unknown }>)[
    CLIENT_EXTENSION_KEY
  ];
  if (value?.version !== 1) {
    throw new TypeError(UPGRADE_ERROR);
  }
  return value as ClientExtension;
}

function matchingString(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

async function boundErrorBody(response: Response): Promise<Response> {
  const reader = response.body!.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return new Response(new Blob(chunks), response);
    if ((size += value.length) > 4_096) {
      reader.cancel().catch(Boolean);
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return new Response(null, {
        status: response.status,
        headers,
      });
    }
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }
}
