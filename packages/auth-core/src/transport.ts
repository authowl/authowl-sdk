import { canonicalTransportUrl } from './url-policy';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

export type TransportErrorKind =
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'response_too_large'
  | 'invalid_response';

/**
 * Stable, secret-safe failure from the shared HTTP boundary.
 *
 * Deliberately does not retain the request URL, headers, body, or underlying
 * error. Server clients may carry secret authorization headers and hostile
 * fetch implementations may echo those values in their error messages.
 */
export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly requestId?: string;

  constructor(kind: TransportErrorKind, requestId?: string) {
    super(transportErrorMessage(kind));
    this.name = 'TransportError';
    this.kind = kind;
    this.requestId = requestId;
  }
}

const internalTransportErrors = new WeakSet<TransportError>();

function transportError(
  kind: TransportErrorKind,
  requestId?: string,
): TransportError {
  const error = new TransportError(kind, requestId);
  internalTransportErrors.add(error);
  return error;
}

export type ResponseDecoder<T> = (
  value: unknown,
  context: Readonly<{ status: number }>,
) => T;

declare const TRANSPORT_FETCH: unique symbol;

/**
 * A `fetch` that has been through the SDK's transport wiring - the ONLY thing
 * this boundary will execute.
 *
 * The brand is a phantom: it exists purely so that `fetchImpl: fetch` and
 * `fetchImpl: config.fetch ?? fetch` stop compiling. That is not pedantry, it is
 * the bug this file has already shipped. The session transport lives in a
 * decorator around `fetch` (see `session-transport.ts`), and the SDK had TWO
 * sibling lines - `http.ts` and `http-client.ts` - each independently writing
 * `config.fetch ?? fetch`. One got the decorator and the other did not, so the
 * JWT issuer and the consent gate stayed broken on exactly the browsers the
 * work existed to fix, with nothing failing anywhere to say so.
 *
 * A brand cannot stop a deliberate cast, and is not meant to. What it stops is
 * the ACCIDENT: reaching this boundary now forces the author to name where the
 * fetch came from, and there are only two answers - `config.fetch`, which
 * carries the session, or `withoutSessionTransport(...)`, which says in one
 * greppable word that this request has no session to carry.
 *
 * The brand is why `requestBoundedJson` can stay what it says it is - network
 * mechanics, stateless, no idea what a session is - while still being the place
 * a missing transport is caught.
 */
export type TransportFetch = typeof fetch & { readonly [TRANSPORT_FETCH]: true };

/**
 * Declare that a `fetch` deliberately carries NO session.
 *
 * Anything that talks to a project on a user's behalf must use `config.fetch`
 * instead, so every use of this is a server-only or credential-free request and
 * says so at the call site. If a new one reaches for this function, that is the
 * review question it exists to raise.
 */
export function withoutSessionTransport(fetchImpl: typeof fetch): TransportFetch {
  return fetchImpl as TransportFetch;
}

export type BoundedJsonResult<T = unknown> = {
  response: Response;
  data: T;
  requestId?: string;
};

type BoundedJsonRequest<T> = {
  /** See {@link TransportFetch}: a bare `fetch` is deliberately not accepted. */
  fetchImpl: TransportFetch;
  url: string | URL;
  init?: RequestInit;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowHttpLoopback?: boolean;
  /** Endpoint-owned runtime contract, invoked only for successful responses. */
  decode?: ResponseDecoder<T>;
};

/**
 * Execute one JSON request with the SDK's transport invariants.
 *
 * This function owns network mechanics only. Status semantics, retries, and
 * runtime validation of endpoint-specific shapes remain at the call site.
 */
export async function requestBoundedJson<T = unknown>({
  fetchImpl,
  url,
  init = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  allowHttpLoopback = false,
  decode,
}: BoundedJsonRequest<T>): Promise<BoundedJsonResult<T>> {
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  assertPositiveInteger(maxResponseBytes, 'maxResponseBytes');
  const requestUrl = canonicalTransportUrl(url, { allowHttpLoopback });

  const callerSignal = init.signal;
  const controller = new AbortController();
  let abortKind: 'aborted' | 'timeout' | null = null;
  let resolveAbort!: (outcome: AbortOutcome) => void;
  const abortGate = new Promise<AbortOutcome>((resolve) => {
    resolveAbort = resolve;
  });
  const abort = (kind: 'aborted' | 'timeout') => {
    if (abortKind !== null) return;
    abortKind = kind;
    resolveAbort({ type: 'abort', kind });
    controller.abort();
  };
  const onCallerAbort = () => abort('aborted');
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = setTimeout(() => abort('timeout'), timeoutMs);
  if (callerSignal?.aborted) onCallerAbort();

  try {
    if (abortKind !== null) throw transportError(abortKind);
    let fetchOutcome: FetchOutcome;
    try {
      fetchOutcome = await Promise.race([
        fetchImpl(
          requestUrl.toString(),
          {
            ...init,
            redirect: 'error',
            signal: controller.signal,
          },
        ).then((response): ResponseOutcome => ({ type: 'response', response })),
        abortGate,
      ]);
    } catch {
      // Never trust a fetch rejection's class or fields. A custom fetch can
      // reject with a same-shaped TransportError carrying secrets.
      throw transportError(abortKind ?? 'network');
    }
    if (fetchOutcome.type === 'abort') {
      throw transportError(fetchOutcome.kind);
    }
    if (!isResponseLike(fetchOutcome.response)) {
      throw transportError('invalid_response');
    }
    const response = fetchOutcome.response;
    const requestId = readRequestId(response.headers);
    const text = await readBoundedBody(
      response,
      maxResponseBytes,
      abortGate,
      () => abortKind,
      requestId,
    );
    const parsed = parseResponseBody(response, text, requestId);
    let data: T;
    try {
      data = response.ok && decode
        ? decode(parsed, Object.freeze({ status: response.status }))
        : parsed as T;
    } catch {
      // Endpoint decoders operate on hostile service data. Never retain their
      // exception because it may reflect a secret-bearing response value.
      throw transportError('invalid_response', requestId);
    }
    return {
      response,
      data,
      ...(requestId === undefined ? {} : { requestId }),
    };
  } catch (error) {
    if (error instanceof TransportError && internalTransportErrors.has(error)) {
      throw error;
    }
    throw transportError(abortKind ?? 'network');
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

type AbortOutcome = {
  type: 'abort';
  kind: 'aborted' | 'timeout';
};

type ResponseOutcome = {
  type: 'response';
  response: Response;
};

type FetchOutcome = AbortOutcome | ResponseOutcome;

function isResponseLike(value: unknown): value is Response {
  if (!value || typeof value !== 'object') return false;
  const response = value as {
    status?: unknown;
    statusText?: unknown;
    ok?: unknown;
    headers?: { get?: unknown };
    body?: { getReader?: unknown; cancel?: unknown } | null;
  };
  return (
    Number.isInteger(response.status)
    && (response.status as number) >= 0
    && (response.status as number) <= 599
    && typeof response.statusText === 'string'
    && typeof response.ok === 'boolean'
    && typeof response.headers?.get === 'function'
    && (
      response.body === null
      || (
        typeof response.body === 'object'
        && typeof response.body?.getReader === 'function'
        && typeof response.body.cancel === 'function'
      )
    )
  );
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  abortGate: Promise<AbortOutcome>,
  getAbortKind: () => 'aborted' | 'timeout' | null,
  requestId: string | undefined,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      cancelBody(response.body);
      throw transportError('invalid_response', requestId);
    }
    if (Number(contentLength) > maxBytes) {
      cancelBody(response.body);
      throw transportError('response_too_large', requestId);
    }
  }

  if (!response.body) return '';
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    throw transportError('network', requestId);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let failure: TransportError | null = null;
  try {
    while (true) {
      let readOutcome: ReadableStreamReadResult<Uint8Array> | AbortOutcome;
      try {
        readOutcome = await Promise.race([reader.read(), abortGate]);
      } catch {
        failure = transportError(getAbortKind() ?? 'network', requestId);
        break;
      }
      if (isAbortOutcome(readOutcome)) {
        failure = transportError(readOutcome.kind, requestId);
        break;
      }
      const { done, value } = readOutcome;
      if (done) break;
      if (value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        failure = transportError('response_too_large', requestId);
        break;
      }
      chunks.push(value);
    }
  } finally {
    if (failure) cancelReader(reader);
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream may keep a read pending after best-effort cancel.
    }
  }
  if (failure) throw failure;

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw transportError('invalid_response', requestId);
  }
}

function isAbortOutcome(
  value: ReadableStreamReadResult<Uint8Array> | AbortOutcome,
): value is AbortOutcome {
  return 'type' in value && value.type === 'abort';
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Best effort only. Never await a hostile cancellation implementation.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Best effort only. Never await a hostile cancellation implementation.
  }
}

function parseResponseBody(
  response: Response,
  text: string,
  requestId: string | undefined,
): unknown {
  if (response.status === 204 || response.status === 205) return null;

  const hasJsonContentType = isJsonContentType(response.headers.get('content-type'));
  if (!response.ok && (!hasJsonContentType || text.length === 0)) return null;
  if (!hasJsonContentType || text.length === 0) {
    throw transportError('invalid_response', requestId);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return null;
    throw transportError('invalid_response', requestId);
  }
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

function readRequestId(headers: Headers): string | undefined {
  const value = headers.get('x-request-id')?.trim();
  if (!value || value.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    return undefined;
  }
  return value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}

function transportErrorMessage(kind: TransportErrorKind): string {
  switch (kind) {
    case 'aborted':
      return 'The request was cancelled.';
    case 'timeout':
      return 'The request timed out.';
    case 'response_too_large':
      return 'The response exceeded the allowed size.';
    case 'invalid_response':
      return 'The service returned an invalid response.';
    case 'network':
      return 'The network request could not be completed.';
  }
}
