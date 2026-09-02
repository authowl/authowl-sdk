'use client';
import * as React from 'react';
import { useMFA, usePublicConfig } from '../hooks';
import { useT } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type MFAChallengeProps = {
  /** Called once the challenge clears and a session is issued. */
  onVerified?: () => void | Promise<void>;
  /**
   * Allow the "trust this device" option when the project's posture permits it.
   * The server capability always wins over this presentation override.
   */
  allowTrustDevice?: boolean;
};

/**
 * The sign-in second-factor prompt: a user with 2FA enrolled gets no session until
 * they clear this. Accepts a TOTP code or, as a fallback, a single-use backup code.
 * Rendered automatically by <SignIn/> when the server withholds the session behind
 * a 2FA challenge; also usable standalone.
 */
export function MFAChallenge({ onVerified, allowTrustDevice = true }: MFAChallengeProps) {
  const t = useT();
  const { config } = usePublicConfig();
  const { verifyTotp, verifyBackupCode, sendOtp, verifyOtp } = useMFA();
  const { pending, error, setError, run } = useSubmitAction();
  const [mode, setMode] = React.useState<'totp' | 'backup' | 'otp'>('totp');
  const [code, setCode] = React.useState('');
  const [trustDevice, setTrustDevice] = React.useState(false);
  // Additive flags default open for rolling compatibility. The server remains
  // the enforcement boundary when an older response does not carry them.
  const canTrustDevice = allowTrustDevice && (config?.mfa?.trustDevice ?? true);
  const canUseEmailOtp = config?.mfa?.emailOtpFallback ?? true;

  // Public config settles asynchronously. If a restrictive posture arrives
  // after the challenge mounted, retire any now-forbidden client state rather
  // than leaving an invisible checked value or an email-code form on screen.
  React.useEffect(() => {
    if (!canTrustDevice) setTrustDevice(false);
    if (!canUseEmailOtp && mode === 'otp') {
      setMode('totp');
      setCode('');
      setError(null);
    }
  }, [canTrustDevice, canUseEmailOtp, mode, setError]);

  // Switching factor clears the entered code AND the prior error - each mode
  // has its own failure copy, so a stale one would read wrong under the new
  // input. (The otp path clears via `run` when it sends.)
  const switchMode = (next: 'totp' | 'backup') => {
    setMode(next);
    setCode('');
    setError(null);
  };

  // B.5d lost-authenticator fallback: entering email-code mode sends the code.
  const requestOtp = () =>
    void run(() => sendOtp({}), {
      failure: t('mfa.challenge.error.otpSendFailed'),
      onSuccess: () => {
        setMode('otp');
        setCode('');
      },
    });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const action =
      mode === 'totp'
        ? () => verifyTotp({ code, trustDevice })
        : mode === 'backup'
          ? () => verifyBackupCode({ code })
          : () => verifyOtp({ code, trustDevice });
    void run(action, {
      failure:
        mode === 'totp'
          ? t('mfa.challenge.error.invalidTotp')
          : mode === 'backup'
            ? t('mfa.challenge.error.invalidBackup')
            : t('mfa.challenge.error.invalidOtp'),
      onSuccess: () => onVerified?.(),
    });
  };

  const hint =
    mode === 'totp'
      ? t('mfa.challenge.totpHint')
      : mode === 'backup'
        ? t('mfa.challenge.backupHint')
        : t('mfa.challenge.otpHint');
  const label =
    mode === 'totp'
      ? t('mfa.challenge.totpLabel')
      : mode === 'backup'
        ? t('mfa.challenge.backupLabel')
        : t('mfa.challenge.otpLabel');

  return (
    <form method="post" className="ba-fields" data-testid="mfa-challenge" onSubmit={submit}>
      <h2 className="ba-title">{t('mfa.challenge.title')}</h2>
      <p className="ba-muted">{hint}</p>
      <label className="ba-label">
        {label}
        <input
          className="ba-input"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.trim());
            setError(null);
          }}
          inputMode={mode === 'backup' ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          required
        />
      </label>
      {mode !== 'backup' && canTrustDevice && (
        <label className="ba-consent ba-consent-centered">
          <span className="ba-checkbox-control">
            <input className="ba-checkbox" type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            <span className="ba-checkbox-visual" aria-hidden="true">
              <span className="ba-checkbox-check" />
            </span>
          </span>
          <span>{t('mfa.challenge.trustDevice', { days: 30 })}</span>
        </label>
      )}
      <FormError>{error}</FormError>
      <button className="ba-button" type="submit" disabled={pending || !code} aria-busy={pending || undefined}>
        <Busy busy={pending} label={t('common.verifying')}>{t('mfa.challenge.submit')}</Busy>
      </button>
      {mode !== 'totp' && (
        <button type="button" className="ba-link-button" onClick={() => switchMode('totp')}>
          {t('mfa.challenge.useTotp')}
        </button>
      )}
      {mode !== 'backup' && (
        <button type="button" className="ba-link-button" onClick={() => switchMode('backup')}>
          {t('mfa.challenge.useBackup')}
        </button>
      )}
      {canUseEmailOtp && (
        <button type="button" className="ba-link-button" disabled={pending} onClick={requestOtp}>
          {t(mode === 'otp' ? 'mfa.challenge.resendOtp' : 'mfa.challenge.useEmailOtp')}
        </button>
      )}
    </form>
  );
}
