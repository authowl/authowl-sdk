'use client';
import { useAuthCardPending } from './AuthCardLock';
import { useStepFocus } from './use-step-focus';
import { AuthField } from './AuthField';
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

  const locked = useAuthCardPending(pending);
  const step = codeSent ? 'code' : 'request';
  const { stepRef, restoreFocus } = useStepFocus(step, true);

  if (codeSent) {
    return (
      <div key={step} ref={stepRef} role="status" className={slot('ba-fields ba-step')} data-testid="signup-emailotp-code">
        <OtpCodeForm
          email={email}
          code={code}
          onCodeChange={setCode}
          pending={locked}
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
    <form
      key={step}
      ref={stepRef}
      method="post"
      className={slot('ba-fields ba-step')}
      data-testid="signup-emailotp-request"
      onSubmit={(event) => {
        event.preventDefault();
        if (locked) return;
        void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => sendEmailOtp({ email, type: 'sign-in' }, options)), {
          failure: t('emailOtp.error.sendFailed'),
          onSuccess: () => setCodeSent(true),
        });
      }}
    >
      <AuthField
        label={t('common.emailLabel')}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
      />
      {authChallenge.control}
      <FormError>{error}</FormError>
      <button
        className={slot('ba-button ba-button-secondary')}
        type="submit"
        disabled={locked || authChallenge.configPending}
        aria-busy={pending || undefined}
      >
        <Busy busy={pending} label={t('common.sending')}>{t('signUp.passwordlessSubmit')}</Busy>
      </button>
    </form>
  );
}
