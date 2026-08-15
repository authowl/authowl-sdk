/**
 * `localStorage` and `sessionStorage`, best-effort.
 *
 * Storage is best-effort on purpose. Safari in private browsing, an embedded
 * webview, and a page under a strict storage policy all throw on the getter
 * ITSELF as well as on the access - and those are the same populations that need
 * the bearer transports most, so a throw must degrade to "this lasts until
 * reload" rather than take down sign-in.
 *
 * One home rather than a copy per cargo. The session token and the sign-in
 * challenge are kept in different slots with deliberately different lifetimes,
 * but they answer the same throw, and a second try/catch is a second policy for
 * it - the version where one cargo swallows a private-browsing failure and the
 * other propagates it out of a sign-in.
 */
export function readFrom(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeTo(
  store: Storage | undefined,
  key: string,
  value: string | null,
): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Ignored - see above.
  }
}

export function localStore(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function sessionStore(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
