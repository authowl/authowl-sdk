'use client';
import { CodeInput, CodeSuccess } from './CodeInput';
import { AuthCardLock } from './AuthCardLock';
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
  onSubmit: () => void;
  /** Go back to collect a different email. */
  onChangeEmail: () => void;
  pending: boolean;
  error: string | null;
  success?: boolean;
};

/**
 * The "enter the emailed code" step, shared by <SignIn/>'s passwordless email-OTP
 * flow and the standalone <EmailOtpForm/> so there is a single source of truth
 * for this screen. Presentational: the caller owns the send/verify calls and the
 * pending/error state (each surface has its own).
 */
export function OtpCodeForm({
  email,
  code,
  onCodeChange,
  onSubmit,
  onChangeEmail,
  pending,
  error,
  success = false,
}: OtpCodeFormProps) {
  const lock = React.useContext(AuthCardLock);
  const locked = pending || Boolean(lock?.locked);
  const slot = useSlot();
  const t = useT();
  const messageId = React.useId();
  const formRef = React.useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      method="post"
      className={slot('ba-fields')}
      data-testid="emailotp-code"
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked && !success) onSubmit();
      }}
    >
      <p id={messageId} role="status" className={slot('ba-muted')}>
        {richMessage(t('emailOtp.codeLabel'), { email: <Bidi>{email}</Bidi> })}
      </p>
      <CodeInput
        aria-labelledby={messageId}
        value={code}
        onChange={onCodeChange}
        onComplete={() => formRef.current?.requestSubmit()}
        state={success ? 'success' : error ? 'error' : 'idle'}
        disabled={locked || success}
        autoFocus
      />
      {success && <CodeSuccess />}
      <FormError>{error}</FormError>
      <button className={slot('ba-button')} type="submit" disabled={locked || success} aria-busy={pending || undefined}>
        <Busy busy={pending} label={t('common.verifying')}>{t('emailOtp.verifySubmit')}</Busy>
      </button>
      <button type="button" className={slot('ba-link-button')} onClick={onChangeEmail}>
        {t('emailOtp.changeEmail')}
      </button>
    </form>
  );
}
