'use client';
import * as React from 'react';
import { useAuthClient, useSession, useUser } from '../hooks';
import { useT } from '../i18n';
import { MFAEnrollment } from './MFAEnrollment';

/**
 * Shared required-MFA enrolment step, used by BOTH <MFARequiredGate/> (which
 * interposes it in front of an app) and <SignIn/> (which finishes it in place).
 *
 * It lives here rather than inside the gate because a project with "Require MFA
 * for everyone" holds a factor-less user's session at enrolment, and that
 * session reads as signed OUT. An app that renders <SignIn/> without the gate
 * therefore re-renders the sign-in form after a SUCCESSFUL sign-in and looks
 * like it did nothing - a dashboard toggle silently bricking sign-in. Both
 * surfaces need the same step, and duplicating the confirmation below would be
 * duplicating a fail-closed security decision.
 */

export type ConfirmedMfaPending = 'clear' | 'confirming' | 'pending';

/**
 * Resolve whether enrolment is GENUINELY outstanding.
 *
 * The cookie-cached pending flag can be stale-true for up to 5 minutes after
 * another device completed enrolment, and re-running enrolment would regenerate
 * the user's TOTP secret - so a cached true is confirmed with an uncached read
 * before any enrolment UI appears. Every failure path resolves to `pending`
 * (fail CLOSED): HTTP errors arrive as `res.error` rather than throwing, and a
 * network failure hits the catch. An already-enrolled user who lands here is
 * safe regardless, because the server refuses `/two-factor/enable` for them, so
 * a live secret cannot be rotated by mistake.
 */
export function useConfirmedMfaPending(
  /**
   * What to believe when the authoritative read FAILS and the answer is
   * genuinely unknown. The right answer differs by surface, and getting it wrong
   * in the sign-in direction locks people out:
   *
   * - `'pending'` for a gate wrapping an app: showing protected content to a
   *   user who may be held is worse than showing enrolment to one who is not.
   * - `'clear'` for a SIGN-IN form: replacing it with an enrolment screen
   *   removes the only way to authenticate, and a stale flag then bricks the
   *   route with no user-side escape. The operator hit exactly this on their own
   *   dashboard and could not sign in at all.
   *
   * Failing open here grants nothing: the hold is enforced SERVER-side - a
   * pending session reads as signed out, `auth()` returns null, and `/token`
   * refuses it - so this only decides which screen renders, never what a
   * held session can do.
   */
  onUnknown: ConfirmedMfaPending = 'pending',
): ConfirmedMfaPending {
  const client = useAuthClient();
  const { needsMfaEnrollment } = useUser();
  const { refetch } = useSession();
  const [confirmed, setConfirmed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!needsMfaEnrollment) {
      setConfirmed(null);
      return;
    }
    let active = true;
    client
      .getSession({ query: { disableCookieCache: true } })
      .then((res) => {
        if (!active) return;
        // A SUCCESSFUL read is always definitive, including one that finds no
        // session: that means signed out, never "still pending".
        const pending = res.error
          ? onUnknown === 'pending'
          : res.data?.session?.pendingMfaEnrollment === true;
        setConfirmed(pending);
        // A confirmed-false without error is the stale-cookie case, repaired by
        // the uncached read's fresh Set-Cookie; pull it into the store so the
        // app unblocks.
        if (!pending && !res.error) refetch({ query: { disableCookieCache: true } });
      })
      .catch(() => {
        if (active) setConfirmed(onUnknown === 'pending');
      });
    return () => {
      active = false;
    };
  }, [client, needsMfaEnrollment, refetch, onUnknown]);

  if (!needsMfaEnrollment) return 'clear';
  return confirmed === true ? 'pending' : 'confirming';
}

export type MfaEnrollmentStepProps = {
  /** Optional heading; defaults to the localized required-MFA title. */
  title?: string;
};

/** The enrolment screen itself. Render only when `useConfirmedMfaPending()` is `pending`. */
export function MfaEnrollmentStep({ title }: MfaEnrollmentStepProps) {
  const t = useT();
  const { refetch } = useSession();
  return (
    <>
      <h2 className="ba-title">{title ?? t('mfaGate.title')}</h2>
      <p className="ba-muted">{t('mfaGate.body')}</p>
      <MFAEnrollment onEnrolled={() => refetch({ query: { disableCookieCache: true } })} />
    </>
  );
}
