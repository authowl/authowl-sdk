export const AUTH_REQUEST_TIMEOUT_MS = 10_000;

/** @internal Bound a complete session request, including response body reads. */
export async function withSessionRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('AuthOwl session transport request timed out.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      request(controller.signal),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function boundedSessionFetch(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return withSessionRequestDeadline(
    (signal) => fetcher(input, { ...init, signal }),
    timeoutMs,
  );
}
