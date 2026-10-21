'use client';
import { CodeInput, CodeSuccess } from './CodeInput';
import { useAuthCardPending } from './AuthCardLock';
import { useSubmitAction } from './use-submit-action';
import type { AuthActionResult } from '@authowl/core';
import { useSlot } from '../elements';
import * as React from 'react';
import { useT, richMessage, Bidi } from '../i18n';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type OtpCodeFormProps = {
  /** The address the code was sent to (shown in the label). */
  email: string;
  /** Controlled code value. */
  code: string;
  onCodeChange: (code: string) => void;
  /** Verify the entered code. */
  onSubmit: () => Promise<AuthActionResult<unknown> | null | undefined>;
  onSuccess: () => void | Promise<void>;
  /** Go back to collect a different email. */
  onChangeEmail: () => void;
};

/**
 * The "enter the emailed code" step, shared by <SignIn/>'s passwordless email-OTP
 * flow and the standalone <EmailOtpForm/>. Owns the verification action and its
 * pending, error and success status through the completion handoff.
 */
export function OtpCodeForm({
  email,
  code,
  onCodeChange,
  onSubmit,
  onChangeEmail,
  onSuccess,
}: OtpCodeFormProps) {
  const { pending, succeeded, error, setError, run } = useSubmitAction();
  const locked = useAuthCardPending(pending);
  const slot = useSlot();
  const t = useT();
  const messageId = React.useId();
  return (
    <form
      method="post"
      className={slot('ba-fields')}
      data-testid="emailotp-code"
      onSubmit={(e) => {
        e.preventDefault();
        if (locked || succeeded) return;
        void run(onSubmit, { failure: t('emailOtp.error.invalidCode'), trackSuccess: true, onSuccess });
      }}
    >
      <p id={messageId} role="status" className={slot('ba-muted')}>
        {richMessage(t('emailOtp.codeLabel'), { email: <Bidi>{email}</Bidi> })}
      </p>
      <CodeInput
        aria-labelledby={messageId}
        value={code}
        onChange={(value) => { onCodeChange(value); setError(null); }}
        state={succeeded ? 'success' : error ? 'error' : 'idle'}
        readOnly={locked} disabled={succeeded}
        autoFocus
      />
      {succeeded && <CodeSuccess />}
      <FormError>{error}</FormError>
      <button className={slot('ba-button')} type="submit" disabled={locked || succeeded} aria-busy={pending || undefined}>
        <Busy busy={pending} label={t('common.verifying')}>{t('emailOtp.verifySubmit')}</Busy>
      </button>
      <button type="button" className={slot('ba-link-button')} onClick={onChangeEmail}>
        {t('emailOtp.changeEmail')}
      </button>
    </form>
  );
}
