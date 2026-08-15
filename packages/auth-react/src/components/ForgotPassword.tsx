'use client';
import * as React from 'react';
import { usePasswordReset } from '../hooks';
import { useT, richMessage, Bidi } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';

export type ForgotPasswordProps = {
  /**
   * The URL of your reset page (where <ResetPassword/> is mounted). The emailed
   * link validates the token then redirects here with `?token=`. Its origin must
   * be one of the project's allowed origins.
   */
  resetPasswordUrl?: string;
  /** Optional "back to sign in" affordance (shown when embedded in <SignIn/>). */
  onBack?: () => void;
};

/**
 * Request a password-reset email. Always shows the same neutral confirmation on
 * success - the server returns success for unknown emails too (anti-enumeration),
 * so the UI must not reveal whether an account exists.
 */
export function ForgotPassword({ resetPasswordUrl, onBack }: ForgotPasswordProps) {
  const t = useT();
  const { requestPasswordReset } = usePasswordReset();
  const { pending, error, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);

  if (sent) {
    return (
      <div className="ba-fields" data-testid="forgot-sent">
        <p className="ba-muted">
          {richMessage(t('forgotPassword.sent'), { email: <Bidi>{email}</Bidi> })}
        </p>
        {onBack && (
          <button type="button" className="ba-link-button" onClick={onBack}>
            {t('forgotPassword.backToSignIn')}
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      method="post"
      className="ba-fields"
      data-testid="forgot-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.reset, (options) => requestPasswordReset({ email, redirectTo: resetPasswordUrl }, options)), {
          failure: t('forgotPassword.error.sendFailed'),
          onSuccess: () => setSent(true),
        });
      }}
    >
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
        <Busy busy={pending} label={t('common.sending')}>{t('forgotPassword.submit')}</Busy>
      </button>
      {onBack && (
        <button type="button" className="ba-link-button" onClick={onBack}>
          {t('forgotPassword.backToSignIn')}
        </button>
      )}
    </form>
  );
}
