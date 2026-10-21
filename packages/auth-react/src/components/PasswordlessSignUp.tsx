'use client';
import { useStepFocus } from './use-step-focus';
import { useSlot } from '../elements';
import * as React from 'react';
import { useSignIn } from '../hooks';
import { useT } from '../i18n';
import { OtpCodeForm } from './OtpCodeForm';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';

export type PasswordlessSignUpProps = {
  onAuthenticated: () => void;
};

/** Prove an email and establish a passwordless account through the email OTP flow. */
export function PasswordlessSignUp({ onAuthenticated }: PasswordlessSignUpProps) {
  const slot = useSlot();
  const t = useT();
  const { sendEmailOtp, signInEmailOtp } = useSignIn();
  const { pending, error, setError, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [codeSent, setCodeSent] = React.useState(false);

  const { stepRef, restoreFocus } = useStepFocus(codeSent ? 'code' : 'request');

  if (codeSent) {
    return (
      <div key="signup-emailotp-code" ref={stepRef} role="status" className={slot('ba-fields ba-step')} data-testid="signup-emailotp-code">
        <OtpCodeForm
          email={email}
          code={code}
          onCodeChange={setCode}
          pending={pending}
          error={error}
          onSubmit={() =>
            void run(() => signInEmailOtp({ email, otp: code }), {
              failure: t('emailOtp.error.invalidCode'),
              onSuccess: onAuthenticated,
            })
          }
          onChangeEmail={() => {
            setCode('');
            setError(null);
            restoreFocus();
            setCodeSent(false);
          }}
        />
      </div>
    );
  }

  return (
    <div key="signup-emailotp-request" ref={stepRef} className={slot('ba-fields ba-step')}>
      <form
        method="post"
        className={slot('ba-fields')}
        data-testid="signup-emailotp-request"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => sendEmailOtp({ email, type: 'sign-in' }, options)), {
            failure: t('emailOtp.error.sendFailed'),
            onSuccess: () => setCodeSent(true),
          });
        }}
      >
        <label className={slot('ba-label')}>
          {t('common.emailLabel')}
          <input
            className={slot('ba-input')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {authChallenge.control}
        <FormError>{error}</FormError>
        <button
          className={slot('ba-button ba-button-secondary')}
          type="submit"
          disabled={pending || authChallenge.configPending}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.sending')}>{t('signUp.passwordlessSubmit')}</Busy>
        </button>
      </form>
    </div>
  );
}
