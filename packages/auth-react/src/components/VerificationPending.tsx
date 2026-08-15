'use client';
import * as React from 'react';
import { useEmailVerification } from '../hooks';
import { useT, richMessage, Bidi } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
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
  const t = useT();
  const {
    sendVerificationEmail,
    sendVerificationCode,
    verifyEmailCode,
  } = useEmailVerification();
  const { pending, error, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [resent, setResent] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [verified, setVerified] = React.useState(false);

  if (verified) {
    return (
      <p className="ba-success" role="status" data-testid="verify-code-success">
        {t('verifyEmail.success')}
      </p>
    );
  }

  if (method === 'code') {
    return (
      <form
        method="post"
        className="ba-fields"
        data-testid="verify-code-pending"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => verifyEmailCode({ email, otp: code }),
            {
              failure: t('verifyPending.codeError'),
              onSuccess: () => setVerified(true),
            },
          );
        }}
      >
        <p className="ba-muted">
          {richMessage(t('verifyPending.codeBody'), {
            email: (
              <strong>
                <Bidi>{email}</Bidi>
              </strong>
            ),
          })}
        </p>
        <label className="ba-label">
          {t('verifyPending.codeLabel')}
          <input
            className="ba-input"
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </label>
        {resent && <p className="ba-muted">{t('verifyPending.resent')}</p>}
        {authChallenge.control}
        <FormError>{error}</FormError>
        <button
          className="ba-button"
          type="submit"
          disabled={pending || !code}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.verifying')}>
            {t('emailOtp.verifySubmit')}
          </Busy>
        </button>
        <button
          type="button"
          className="ba-link-button"
          disabled={pending || authChallenge.configPending}
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
    <div className="ba-fields" data-testid="verify-pending">
      <p className="ba-muted">
        {richMessage(t('verifyPending.body'), {
          email: (
            <strong>
              <Bidi>{email}</Bidi>
            </strong>
          ),
        })}
      </p>
      {resent && <p className="ba-muted">{t('verifyPending.resent')}</p>}
      {authChallenge.control}
      <FormError>{error}</FormError>
      <button
        type="button"
        className="ba-link-button"
        disabled={pending || authChallenge.configPending}
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
