'use client';
import * as React from 'react';
import { membershipHas, type AuthUser } from '@authowl/core';
import { useSession, useUser } from '../hooks';
import { useT } from '../i18n';
import { Spinner } from './Spinner';

/**
 * Conditional-render helpers gated on the client session. They render nothing
 * until the session has loaded (avoids a signed-out flash), then show/hide.
 *
 * IMPORTANT: these are UX affordances, NOT a security boundary. The session they
 * read lives in the browser and can be spoofed; never gate access to secret data
 * or privileged actions on them. Enforce real authorization on the server (verify
 * the session with @authowl/next's `auth()` in a route handler / server
 * component). Same posture as Clerk's `<SignedIn>`/`<Protect>`.
 */

export type SignedInProps = { children: React.ReactNode };

/** Renders its children only when a user is signed in. */
export function SignedIn({ children }: SignedInProps) {
  const { isLoaded, isSignedIn } = useUser();
  return isLoaded && isSignedIn ? <>{children}</> : null;
}

export type SignedOutProps = { children: React.ReactNode };

/** Renders its children only when no user is signed in (once loaded). */
export function SignedOut({ children }: SignedOutProps) {
  const { isLoaded, isSignedIn } = useUser();
  return isLoaded && !isSignedIn ? <>{children}</> : null;
}

export type ProtectProps = {
  children: React.ReactNode;
  /** Shown instead of the children when the user is signed out or fails a gate. */
  fallback?: React.ReactNode;
  /**
   * Require the active organization membership's role to match (built-in
   * `owner`/`admin`/`member` or a project role key). Read from the client
   * session claim.
   */
  role?: string;
  /**
   * Require the active organization membership to grant this permission -
   * `org:sys_*` or a custom `org:<feature>:<action>` id. Evaluated against the
   * LOCAL session claim (never a statement-only has-permission route).
   */
  permission?: string;
  /**
   * Require membership of this team within the active organization. Teams are pure
   * grouping, so this gates on WHICH GROUP someone is in, not on authority. A
   * session predating teams proves no team and fails the gate.
   */
  teamId?: string;
  /** Extra gate on the signed-in user (e.g. a custom flag). Signed-in is always required. */
  condition?: (user: AuthUser) => boolean;
};

/**
 * Renders `children` when the user is signed in AND passes every provided gate
 * (`role`, `permission`, `condition` - all must pass), otherwise `fallback`.
 * Renders nothing until the session has loaded.
 *
 * ADVISORY ONLY. `role`/`permission` here are a UX affordance read from the
 * browser session claim, which a client can spoof - gating custom-permission UI
 * this way hides controls, it does NOT secure them. Enforce the real boundary
 * server-side over a VERIFIED project token (`@authowl/next`'s server `has()`),
 * which checks the token signature before trusting any membership claim (§5).
 */
export function Protect({
  children,
  fallback = null,
  role,
  permission,
  teamId,
  condition,
}: ProtectProps) {
  const { user, isLoaded, isSignedIn } = useUser();
  // Read membership straight off the session claim - no fetch, so any number of
  // <Protect> on a page stays cheap (unlike useOrganization, which loads the org).
  const membership = useSession().data?.session?.membership ?? null;
  if (!isLoaded) return null;
  if (!isSignedIn || !user) return <>{fallback}</>;
  if (
    (role !== undefined || permission !== undefined || teamId !== undefined)
    && !membershipHas(membership, { role, permission, teamId })
  ) {
    return <>{fallback}</>;
  }
  if (condition && !condition(user)) return <>{fallback}</>;
  return <>{children}</>;
}

export type AuthLoadingProps = {
  /**
   * Shown while the session is still bootstrapping. Defaults to a centered
   * spinner with an sr-only "Loading…" label, so the common case is a
   * self-closing `<AuthLoading />`.
   */
  children?: React.ReactNode;
};

/**
 * Renders while the client session is still loading (`!useUser().isLoaded`),
 * then nothing. Pair it as a SIBLING of `<SignedIn>`/`<SignedOut>` to cover the
 * blank window after a page load or SSO/redirect landing before the session
 * resolves. This is the Clerk-style split (`<AuthLoading>`/`<AuthLoaded>`)
 * rather than a `loading` prop on `<SignedIn>`/`<SignedOut>`: those render as
 * siblings, so per-component fallbacks would paint two spinners at once. One
 * `<AuthLoading>` owns the loading window.
 */
export function AuthLoading({ children }: AuthLoadingProps) {
  const t = useT();
  const { isLoaded } = useUser();
  if (isLoaded) return null;
  if (children !== undefined) return <>{children}</>;
  return (
    <div className="ba-auth-loading" role="status" aria-busy="true" data-testid="auth-loading">
      <Spinner />
      <span className="ba-sr-only">{t('common.loading')}</span>
    </div>
  );
}

export type AuthLoadedProps = { children: React.ReactNode };

/** Renders its children only once the session has finished loading. */
export function AuthLoaded({ children }: AuthLoadedProps) {
  return useUser().isLoaded ? <>{children}</> : null;
}
