'use client';
import * as React from 'react';
import { AuthOwlBadge } from './AuthOwlBadge';
import { MfaEnrollmentStep, useConfirmedMfaPending } from './mfa-enrollment-step';

export type MFARequiredGateProps = {
  /** The protected app content shown once the session is fully authenticated. */
  children: React.ReactNode;
  /** Optional heading for the enrolment screen. */
  title?: string;
};

/**
 * Required-MFA gate (B.5c): on projects with "Require MFA for everyone", a
 * factor-less user's session is held at enrolment (CONTRACTS §5) - `useUser`
 * reads it as signed OUT while `needsMfaEnrollment` is true. Wrap your app in
 * this gate to interpose the enrolment screen until the user activates a
 * factor; free to wrap unconditionally (it renders children untouched in
 * every other state, same non-blocking design as <ConsentGate/>).
 *
 * PLACEMENT: the gate must wrap a layout that includes your SIGN-IN route.
 * Server pages that `redirect('/sign-in')` on a null `auth()` bounce pending
 * users there (a pending session reads as signed out server-side) - if the
 * gate only wraps protected content, they re-sign-in into another pending
 * session without ever seeing enrolment.
 *
 * NOT REQUIRED for a client-rendered <SignIn/>: that component now finishes
 * enrolment in place, so a project can turn required MFA on without every app
 * having to adopt this gate first. The gate still matters for server-redirect
 * layouts and for apps that reach protected content by another route.
 *
 * The stale-flag confirmation both surfaces depend on lives in
 * `useConfirmedMfaPending`.
 */
export function MFARequiredGate({ children, title }: MFARequiredGateProps) {
  const state = useConfirmedMfaPending();

  if (state === 'clear') return <>{children}</>;
  if (state === 'confirming') return null; // confirming, or stale flag being repaired

  return (
    <div className="ba-form" data-testid="mfa-required-gate">
      <MfaEnrollmentStep title={title} />
      <AuthOwlBadge />
    </div>
  );
}
