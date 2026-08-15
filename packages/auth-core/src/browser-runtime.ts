/**
 * Whether this runtime has the browser APIs the cross-site sign-in transport
 * needs.
 *
 * Its own module on purpose. `session-handoff.ts` is loaded on demand so its
 * browser-only body never reaches a React Native bundle or an initial page
 * payload - but a static import of anything inside it defeats that, because the
 * bundler then links the whole module. This holds the one predicate the eager
 * path needs, so the rest stays behind the dynamic import.
 *
 * Named for what it tests. It is NOT a cross-site check: the transport is the
 * default for every browser, same-site included, because sniffing the
 * relationship between the app and the auth host would be guesswork and the
 * first-party start is correct either way.
 */
export function isBrowserRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle?.digest === 'function'
  );
}
