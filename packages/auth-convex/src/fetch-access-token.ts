/**
 * The bridge between AuthOwl's named `getToken({ template, forceRefresh })` and Convex's
 * `fetchAccessToken({ forceRefreshToken })` (its AuthTokenFetcher). Pure and
 * separately tested; the provider hook wraps it in the reactive plumbing.
 *
 * Two deliberate behaviors on top of the direct mapping:
 *  - Failures resolve to `null` - Convex treats null as "unauthenticated";
 *    a thrown error here would break its auth state machine.
 *  - Every call selects the `convex` dashboard template.
 *  - The FIRST call of each instance force-refreshes. One instance exists per
 *    Convex auth generation (the provider rebuilds it when the active org
 *    changes, and Convex re-runs setAuth on sign-in). Even though named cache
 *    records include user and organization, a fresh generation force-mints so
 *    it cannot follow a stale active pointer after an external cookie change.
 *    On a cold mount the cache is empty anyway, so the force costs nothing.
 */
export type AuthOwlGetToken = (options?: {
  template?: string;
  forceRefresh?: boolean;
}) => Promise<string | null>;

export function createFetchAccessToken(getToken: AuthOwlGetToken) {
  let firstCall = true;
  return async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
    const forceRefresh = forceRefreshToken || firstCall;
    firstCall = false;
    try {
      return await getToken({ template: 'convex', forceRefresh });
    } catch {
      return null;
    }
  };
}
