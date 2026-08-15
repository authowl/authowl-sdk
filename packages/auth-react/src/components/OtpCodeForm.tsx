'use client';
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
}: OtpCodeFormProps) {
  const t = useT();
  return (
    <form
      method="post"
      className="ba-fields"
      data-testid="emailotp-code"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="ba-label">
        {richMessage(t('emailOtp.codeLabel'), { email: <Bidi>{email}</Bidi> })}
        <input
          className="ba-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          autoFocus
          required
        />
      </label>
      <FormError>{error}</FormError>
      <button className="ba-button" type="submit" disabled={pending} aria-busy={pending || undefined}>
        <Busy busy={pending} label={t('common.verifying')}>{t('emailOtp.verifySubmit')}</Busy>
      </button>
      <button type="button" className="ba-link-button" onClick={onChangeEmail}>
        {t('emailOtp.changeEmail')}
      </button>
    </form>
  );
}
