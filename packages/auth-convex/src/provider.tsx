'use client';
import * as React from 'react';
import { ConvexProviderWithAuth } from 'convex/react';
import { createFetchAccessToken, type AuthOwlGetToken } from './fetch-access-token';

/**
 * `ConvexProviderWithClerk`, but for AuthOwl - a 1:1 mirror of the shape and
 * semantics of the real Clerk adapter (read from the convex@1.42.1 source;
 * evidence 17-B.9), so migrating off Clerk is a one-line provider swap:
 *
 *   - import { ConvexProviderWithClerk } from 'convex/react-clerk';
 *   - import { useAuth } from '@clerk/clerk-react';
 *   + import { ConvexProviderWithAuthOwl } from '@authowl/convex';
 *   + import { useAuth } from '@authowl/react';
 *
 *   <ConvexProviderWithAuthOwl client={convex} useAuth={useAuth}>
 *
 * `useAuth` is injected (dependency injection, exactly like the Clerk
 * adapter) so this package needs no dependency on @authowl/react and never
 * duplicates its React context. The server side is the project's JWT issuer
 * (Settings -> JWT issuer); Convex verifies tokens statelessly against the
 * project's JWKS - configure `convex/auth.config.ts` from
 * public-config `jwtIssuer` (`{ type: "customJwt", issuer, jwks: jwksUrl,
 * applicationID: aud, algorithm: "ES256" }`).
 */

/** The slice of `@authowl/react`'s useAuth this adapter consumes (structural). */
export type UseAuthOwl = () => {
  isLoaded: boolean;
  isSignedIn: boolean;
  /** Signed-in user id; an identity change re-authenticates Convex with a fresh token. */
  userId: string | null;
  /** Active organization id; a change re-authenticates so tokens carry the new org_id. */
  orgId?: string | null;
  getToken: AuthOwlGetToken;
};

export type ConvexProviderWithAuthOwlProps = {
  children: React.ReactNode;
  // Convex doesn't export its client prop type (IConvexReactClient is
  // module-private) - extract it from the component so it can never drift.
  client: React.ComponentProps<typeof ConvexProviderWithAuth>['client'];
  /** Pass `useAuth` from `@authowl/react`. */
  useAuth: UseAuthOwl;
};

export function ConvexProviderWithAuthOwl({
  children,
  client,
  useAuth,
}: ConvexProviderWithAuthOwlProps) {
  const useAuthFromAuthOwl = useAuthOwlAuth(useAuth);
  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromAuthOwl}>
      {children}
    </ConvexProviderWithAuth>
  );
}

/**
 * Adapt AuthOwl's `useAuth` into the `{ isLoading, isAuthenticated,
 * fetchAccessToken }` hook Convex's generic `ConvexProviderWithAuth` consumes.
 */
function useAuthOwlAuth(useAuth: UseAuthOwl) {
  return React.useMemo(
    () =>
      function useAuthFromAuthOwl() {
        const { isLoaded, isSignedIn, getToken, userId, orgId } = useAuth();
        const fetchAccessToken = React.useMemo(
          () => createFetchAccessToken(getToken),
          // A new fetchAccessToken identity re-runs Convex's setAuth AND (via
          // the bridge's first-call force) mints a fresh token, so it is keyed
          // on everything that defines the auth identity: the USER (an
          // in-place A->B sign-in keeps isAuthenticated true - without this
          // key Convex would keep A's auth) and the active ORG (the new token
          // must carry the new org_id claim). Clerk keys on [orgId, orgRole]
          // only because its getToken observes Clerk's session directly. Our
          // cache is identity-keyed from minted claims but cannot observe a new
          // cookie identity before the next request. getToken itself is stable
          // on the client instance and omitted.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [userId, orgId],
        );
        return React.useMemo(
          () => ({
            isLoading: !isLoaded,
            isAuthenticated: isSignedIn ?? false,
            fetchAccessToken,
          }),
          [isLoaded, isSignedIn, fetchAccessToken],
        );
      },
    [useAuth],
  );
}
