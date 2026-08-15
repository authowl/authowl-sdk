'use client';
import * as React from 'react';
import { useEmailVerification } from '../hooks';
import { useT, richMessage, Bidi } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { safeRedirect } from './redirect';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';

export type VerifyEmailProps = {
  /** Where to send the user after a successful verification - your sign-in page. */
  redirectTo?: string;
  /** Called once when the page loads in the verified (no-error) state. */
  onVerified?: () => void;
  /** Where a resent link should land; defaults to this page's own URL. */
  callbackURL?: string;
};

/**
 * Landing page for the verification link. The server confirms the address (it
 * does NOT sign the user in - verification is login-CSRF-safe), then redirects
 * here, appending `?error=CODE` only on failure. So this reads the outcome from
 * the URL: success shows a confirmation and can redirect to your sign-in page;
 * failure offers a resend. Point `redirectTo` at your sign-in route.
 */
export function VerifyEmail({ redirectTo, onVerified, callbackURL }: VerifyEmailProps) {
  const t = useT();
  const { sendVerificationEmail } = useEmailVerification();
  const { pending, error, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [resent, setResent] = React.useState(false);

  React.useEffect(() => {
    const didFail = new URLSearchParams(window.location.search).has('error');
    setFailed(didFail);
    setReady(true);
    if (!didFail) {
      onVerified?.();
      if (redirectTo) safeRedirect(redirectTo);
    }
  }, [onVerified, redirectTo]);

  if (!ready) {
    return (
      <div className="ba-form" aria-busy="true">
        <div className="ba-skeleton" />
      </div>
    );
  }

  if (!failed) {
    return (
      <p className="ba-muted" data-testid="verify-success">
        {t('verifyEmail.success')}
      </p>
    );
  }

  // The link was invalid or expired - offer to send a fresh one. We don't know
  // the address here (the token was opaque), so ask for it.
  return (
    <form
      method="post"
      className="ba-fields"
      data-testid="verify-failed"
      onSubmit={(e) => {
        e.preventDefault();
        const landing = callbackURL ?? window.location.origin + window.location.pathname;
        void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.verifyEmail, (options) => sendVerificationEmail({ email, callbackURL: landing }, options)), {
          failure: t('verifyEmail.error.resendFailed'),
          onSuccess: () => setResent(true),
        });
      }}
    >
      <FormError>{t('verifyEmail.invalidLink')}</FormError>
      {resent ? (
        <p className="ba-muted">
          {richMessage(t('verifyEmail.resent'), { email: <Bidi>{email}</Bidi> })}
        </p>
      ) : (
        <>
          <label className="ba-label">
            {t('common.emailLabel')}
            <input
              className="ba-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {authChallenge.control}
          <FormError>{error}</FormError>
          <button
            className="ba-button"
            type="submit"
            disabled={pending || authChallenge.configPending}
            aria-busy={pending || undefined}
          >
            <Busy busy={pending} label={t('common.sending')}>{t('verifyEmail.resendSubmit')}</Busy>
          </button>
        </>
      )}
    </form>
  );
}
