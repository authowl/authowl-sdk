'use client';
import * as React from 'react';
import { useAuthClient, useSignIn } from '../hooks';
import { useT } from '../i18n';
import { emailAutocomplete } from '../signin-methods';
import { finishSignIn } from './finish-sign-in';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { OtpCodeForm } from './OtpCodeForm';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';

export type EmailOtpFormProps = {
  redirectTo?: string;
  /** Called after the code is verified and a session is issued. */
  onSignedIn?: () => void;
  /** Append the `webauthn` autofill token to the email input (passkey host). */
  webauthnAutofill?: boolean;
};

/**
 * Passwordless email one-time-code sign-in, in two stages: request a code for an
 * email, then verify the emailed code to complete sign-in. A session is issued
 * on successful verification (unlike magic-link, which round-trips via email).
 */
export function EmailOtpForm({ redirectTo, onSignedIn, webauthnAutofill }: EmailOtpFormProps) {
  const t = useT();
  const { sessionStore } = useAuthClient();
  const { sendEmailOtp, signInEmailOtp } = useSignIn();
  const { pending, error, setError, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [stage, setStage] = React.useState<'email' | 'code'>('email');

  if (stage === 'code') {
    return (
      <OtpCodeForm
        email={email}
        code={otp}
        onCodeChange={(value) => {
          setOtp(value);
          setError(null);
        }}
        pending={pending}
        error={error}
        onSubmit={() =>
          void run(() => signInEmailOtp({ email, otp }), {
            failure: t('emailOtp.error.invalidCode'),
            onSuccess: () => finishSignIn({ sessionStore, redirectTo, onSignedIn }),
          })
        }
        onChangeEmail={() => {
          setStage('email');
          setOtp('');
          setError(null);
        }}
      />
    );
  }

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => sendEmailOtp({ email, type: 'sign-in' }, options)), {
          failure: t('emailOtp.error.sendFailed'),
          onSuccess: () => setStage('code'),
        });
      }}
      className="ba-fields"
      data-testid="emailotp-email"
    >
      <label className="ba-label">
        {t('common.emailLabel')}
        <input
          className="ba-input"
          type="email"
          autoComplete={emailAutocomplete(!!webauthnAutofill)}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
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
        <Busy busy={pending} label={t('common.sending')}>{t('emailOtp.requestSubmit')}</Busy>
      </button>
    </form>
  );
}
