'use client';
import { flushSync } from 'react-dom';
import { useSlot } from '../elements';
import * as React from 'react';
import { useEmailVerification } from '../hooks';
import { useT, richMessage, Bidi } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { CodeInput, CodeSuccess } from './CodeInput';
import { useAuthCardPending } from './AuthCardLock';
import { FormError } from './FormError';

export type VerificationPendingProps = {
  /** The address the verification link or code was sent to. */
  email: string;
  /** Where the link should land after confirming (your <VerifyEmail/> page). */
  callbackURL?: string;
  /** Ownership-verification ceremony selected by the AuthOwl project. */
  method?: 'link' | 'code';
};

/**
 * "Check your email" panel shown after a sign-up that requires verification. Lets
 * the user resend the link. Rendered by <SignUp/>; also usable standalone.
 */
export function VerificationPending({
  email,
  callbackURL,
  method = 'link',
}: VerificationPendingProps) {
  const slot = useSlot();
  const t = useT();
  const {
    sendVerificationEmail,
    sendVerificationCode,
    verifyEmailCode,
  } = useEmailVerification();
  const { pending, error, setError, run } = useSubmitAction();
  const locked = useAuthCardPending(pending);
  const formRef = React.useRef<HTMLFormElement>(null);
  const authChallenge = useAuthChallenge();
  const [resent, setResent] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const [verified, setVerified] = React.useState(false);

  if (verified) {
    return (
      <p className={slot('ba-success')} role="status" data-testid="verify-code-success">
        <CodeSuccess /> {t('verifyEmail.success')}
      </p>
    );
  }

  if (method === 'code') {
    return (
      <form
        ref={formRef}
        method="post"
        className={slot('ba-fields')}
        data-testid="verify-code-pending"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked) return;
          void run(
            () => verifyEmailCode({ email, otp: code }),
            {
              failure: t('verifyPending.codeError'),
              onSuccess: () => { flushSync(() => setSuccess(true)); setVerified(true); },
            },
          );
        }}
      >
        <p role="status" className={slot('ba-muted')}>
          {richMessage(t('verifyPending.codeBody'), {
            email: (
              <strong>
                <Bidi>{email}</Bidi>
              </strong>
            ),
          })}
        </p>
        <label className={slot('ba-label')}>
          {t('verifyPending.codeLabel')}
          <CodeInput value={code} onChange={(value) => { setCode(value); setError(null); }}
            onComplete={() => formRef.current?.requestSubmit()} state={success ? 'success' : error ? 'error' : 'idle'} disabled={locked || success} />
        </label>
        {resent && <p role="status" className={slot('ba-muted')}>{t('verifyPending.resent')}</p>}
        {authChallenge.control}
        {success && <CodeSuccess />}
        <FormError>{error}</FormError>
        <button
          className={slot('ba-button')}
          type="submit"
          disabled={locked || !code}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.verifying')}>
            {t('emailOtp.verifySubmit')}
          </Busy>
        </button>
        <button
          type="button"
          className={slot('ba-link-button')}
          disabled={locked || authChallenge.configPending}
          onClick={() =>
            void run(
              () => authChallenge.run(
                AUTH_CHALLENGE_ACTIONS.verifyEmail,
                (options) => sendVerificationCode(
                  { email, type: 'email-verification' },
                  options,
                ),
              ),
              {
                failure: t('verifyPending.error.resendFailed'),
                onSuccess: () => setResent(true),
              },
            )
          }
        >
          {t('verifyPending.resendCode')}
        </button>
      </form>
    );
  }

  return (
    <div className={slot('ba-fields')} data-testid="verify-pending">
      <p role="status" className={slot('ba-muted')}>
        {richMessage(t('verifyPending.body'), {
          email: (
            <strong>
              <Bidi>{email}</Bidi>
            </strong>
          ),
        })}
      </p>
      {resent && <p role="status" className={slot('ba-muted')}>{t('verifyPending.resent')}</p>}
      {authChallenge.control}
      <FormError>{error}</FormError>
      <button
        type="button"
        className={slot('ba-link-button')}
        disabled={locked || authChallenge.configPending}
        aria-busy={pending || undefined}
        onClick={() =>
          void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.verifyEmail, (options) => sendVerificationEmail({ email, callbackURL }, options)), {
            failure: t('verifyPending.error.resendFailed'),
            onSuccess: () => setResent(true),
          })
        }
      >
        <Busy busy={pending} label={t('common.sending')}>{t('verifyPending.resendButton')}</Busy>
      </button>
    </div>
  );
}
