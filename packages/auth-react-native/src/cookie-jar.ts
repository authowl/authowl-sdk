/**
 * A one-cookie jar backed by secure storage.
 *
 * Why this exists: the AuthOwl server authenticates with a session COOKIE, and
 * the browser SDK simply lets the browser's cookie jar do the work. React Native
 * has no dependable equivalent - its `fetch` cookie behaviour differs between
 * iOS and Android, is invisible to JS, and does not reliably survive an app
 * restart or update. So the native SDK keeps the one cookie it cares about
 * itself: replay it on every request, and re-capture it whenever the server
 * rotates it.
 *
 * This talks to the server exactly as the browser does, so no server-side
 * "native mode" is required.
 */

import { sessionCookieName } from '@authowl/core/native';

import type { SecureStorage } from './storage';

export interface CookieJarOptions {
  /** Where the session cookie is persisted. */
  storage: SecureStorage;
  /** The project id, used to derive the exact cookie name the server sets. */
  projectId: string;
  /**
   * Whether the server issues `__Secure-` cookies. Derive it from the API URL's
   * scheme (`https:` => true) - it must match the SERVER, not the client.
   */
  secure: boolean;
  /** Defaults to the global fetch. Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** The storage key under which the raw cookie value is kept. */
export function sessionStorageKey(projectId: string): string {
  return `authowl.session.${projectId}`;
}

/**
 * Parse the cookie value the server set for `name`, if this response sets it.
 *
 * Deliberately hand-rolled and narrow: it looks for ONE cookie by exact name and
 * ignores every attribute (`Path`, `HttpOnly`, `SameSite`, …). A general cookie
 * jar would have to model domains and paths, which is a large amount of surface
 * for a client that only ever talks to one origin.
 *
 * Returns `null` when the response does not set the cookie, and the empty string
 * when the server clears it (sign-out), which the caller treats as a deletion.
 */
export function readSetCookie(
  header: readonly string[] | string | null,
  name: string,
): string | null {
  if (!header) return null;
  // `set-cookie` values legitimately contain commas (in `Expires`), so a
  // comma-joined header cannot be split back apart unambiguously. Prefer the
  // separated values; a single string is still accepted and split on newlines,
  // which is how some runtimes join repeated headers.
  const entries = typeof header === 'string' ? header.split('\n') : header;
  for (const entry of entries) {
    const trimmed = entry.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator).trim() !== name) continue;
    const value = trimmed.slice(separator + 1).split(';', 1)[0] ?? '';
    return value;
  }
  return null;
}

/**
 * The response's `Set-Cookie` values, kept separate.
 *
 * `Headers.get('set-cookie')` collapses repeated headers into one comma-joined
 * string, which is lossy for cookies. `getSetCookie()` returns them intact and
 * is the correct API where it exists; the join is only a fallback for older
 * React Native `Headers` polyfills that lack it.
 */
function setCookieValues(headers: Headers): readonly string[] | string | null {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  return headers.get('set-cookie');
}

/** Merge our stored session cookie into an existing `Cookie` header, if any. */
function withSessionCookie(
  headers: Headers,
  name: string,
  value: string,
): void {
  const existing = headers.get('cookie');
  const pair = `${name}=${value}`;
  headers.set('cookie', existing ? `${existing}; ${pair}` : pair);
}

/**
 * Wrap `fetch` so the session cookie is replayed from, and captured into,
 * secure storage.
 */
export function createCookieJarFetch(options: CookieJarOptions): typeof fetch {
  const { storage, projectId, secure } = options;
  const baseFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof baseFetch !== 'function') {
    throw new Error(
      '@authowl/react-native requires a global fetch. Pass `fetchImpl` if your runtime lacks one.',
    );
  }
  const cookieName = sessionCookieName(projectId, { secure });
  const storageKey = sessionStorageKey(projectId);

  return async function cookieJarFetch(input, init) {
    // Public configuration explicitly uses `credentials: 'omit'`. A native jar
    // must honor that itself because React Native fetch has no browser cookie
    // policy to enforce on this manually replayed credential.
    const useSessionJar = init?.credentials !== 'omit';
    const stored = useSessionJar ? await storage.getItem(storageKey) : null;
    // Merge headers WITHOUT constructing an intermediate Request: re-wrapping a
    // Request re-reads its body stream, and mutating a Request's `Cookie` header
    // is guarded in some fetch implementations. Passing plain headers through
    // `init` works on every runtime the SDK targets.
    const inherited = init?.headers
      ?? (typeof input === 'object' && input !== null && 'headers' in input
        ? (input as Request).headers
        : undefined);
    const headers = new Headers(inherited);
    if (stored) withSessionCookie(headers, cookieName, stored);

    const response = await baseFetch(input, { ...init, headers });

    const issued = useSessionJar
      ? readSetCookie(setCookieValues(response.headers), cookieName)
      : null;
    if (issued !== null) {
      // An empty value is the server clearing the cookie (sign-out). Removing it
      // rather than storing "" keeps `getItem` honest for the next request.
      if (issued === '') await storage.removeItem(storageKey);
      else await storage.setItem(storageKey, issued);
    }
    return response;
  };
}
