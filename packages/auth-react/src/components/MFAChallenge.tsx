'use client';
import { useSlot } from '../elements';
import * as React from 'react';
import { useMFA, usePublicConfig, useUser } from '../hooks';
import { Bidi, richMessage, useT } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { CodeInput, CodeSuccess } from './CodeInput';
import { FactorIcon } from './factor-icons';
import { useAuthCardPending } from './AuthCardLock';
import { FormError } from './FormError';

export type MFAChallengeProps = {
  /** Known email destination, including a sign-in challenge with no session yet. */
  email?: string;
  /** Called once the factor is accepted (a session is issued on `sign-in`). */
  onVerified?: () => void | Promise<void>;
  /**
   * Allow the "trust this device" option when the project's posture permits it.
   * The server capability always wins over this presentation override. Ignored
   * on `step-up`, where the server has no trust to grant.
   */
  allowTrustDevice?: boolean;
  /**
   * What this prompt is FOR, which decides its copy and whether device trust is
   * on offer:
   *
   *  - `sign-in`   the session is withheld until the factor clears. The default.
   *  - `step-up`   the user is ALREADY signed in and is re-proving the factor to
   *                authorize a change that would weaken it. The server's
   *                full-session branch returns the existing token and creates no
   *                session, so nothing here may read as signing in - and it
   *                cannot mint a trust cookie, so the checkbox is not offered.
   */
  variant?: 'sign-in' | 'step-up';
  /** Abandon the prompt. Rendered as a Cancel control when provided. */
  onCancel?: () => void;
};

/**
 * The second-factor prompt. Accepts a TOTP code or, as a fallback, a single-use
 * backup code or an emailed code where the project's posture permits one.
 *
 * Serves two moments, which `variant` selects between. At `sign-in` a user with
 * 2FA enrolled gets no session until they clear this, and <SignIn/> renders it
 * automatically when the server withholds one. At `step-up` an already
 * signed-in user re-proves the factor to authorize a change that would weaken
 * it - the same three factors, different copy, and no device trust on offer.
 */
export function MFAChallenge({
  onVerified,
  email,
  allowTrustDevice = true,
  variant = 'sign-in',
  onCancel,
}: MFAChallengeProps) {
  const slot = useSlot();
  const t = useT();
  const { config } = usePublicConfig();
  const { user } = useUser();
  const { verifyTotp, verifyBackupCode, sendOtp, verifyOtp } = useMFA();
  const { pending: verifying, succeeded: success, error: verifyError, setError, run } = useSubmitAction();
  const resend = useSubmitAction();
  const locked = useAuthCardPending(verifying || resend.pending);
  const blocked = locked || success;
  const error = verifyError || resend.error;
  const [retryVerify, setRetryVerify] = React.useState(false);
  const helperId = React.useId();
  const otherWaysId = React.useId();
  const [mode, setMode] = React.useState<'totp' | 'backup' | 'otp'>('totp');
  const [code, setCode] = React.useState('');
  const [trustDevice, setTrustDevice] = React.useState(false);
  const destination = email || user?.email;
  const stepUp = variant === 'step-up';
  // Additive flags default open for rolling compatibility. The server remains
  // the enforcement boundary when an older response does not carry them.
  //
  // `canTrustDevice` is additionally false on a step-up: the engine's
  // full-session branch ignores `trustDevice` outright, so offering the
  // checkbox there would be a control that does nothing.
  const canTrustDevice = !stepUp && allowTrustDevice && (config?.mfa?.trustDevice ?? true);
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
    if (blocked) return;
    setMode(next);
    setCode('');
    setError(null);
    resend.setError(null);
    setRetryVerify(false);
  };

  // B.5d lost-authenticator fallback: entering email-code mode sends the code.
  const requestOtp = () => {
    if (blocked) return;
    setError(null);
    void resend.run(() => sendOtp({}), {
      failure: t('mfa.challenge.error.otpSendFailed'),
      onSuccess: () => {
        setMode('otp');
        setCode('');
        setRetryVerify(false);
      },
    });
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blocked) return;
    resend.setError(null);
    // Throws and completion-handoff failures can retry the same code.
    setRetryVerify(true);
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
      trackSuccess: true,
      mapError: (authError) => {
        const codeFailure = (authError.status ?? 400) < 500 && ['INVALID_CODE', 'INVALID_TOTP', 'INVALID_OTP', 'INVALID_BACKUP_CODE', 'OTP_EXPIRED', 'OTP_HAS_EXPIRED'].includes(authError.code ?? '');
        setRetryVerify(!codeFailure);
        return null;
      },
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
    <form method="post" className={slot('ba-fields ba-factor-form')} data-testid="mfa-challenge" onSubmit={submit}>
      <header className={slot('ba-factor-header')}>
        <h2 className={slot('ba-title')}>{t(stepUp ? 'mfa.stepUp.title' : 'mfa.challenge.title')}</h2>
        <p className={slot('ba-factor-subtitle')}>
          {mode === 'otp' && destination
            ? richMessage(t('mfa.challenge.otpDestination'), { email: <strong><Bidi>{destination}</Bidi></strong> })
            : hint}
        </p>
      </header>
      {mode === 'backup' ? (
        <label className={slot('ba-label')}>
          {label}
          <input className={slot('ba-input')} value={code}
            onChange={(e) => { setCode(e.target.value.trim()); setError(null); }}
            inputMode="text" autoComplete="one-time-code" autoFocus required readOnly={locked} disabled={success} />
        </label>
      ) : (
        <CodeInput key={mode} value={code} onChange={(value) => { setCode(value); setError(null); }}
          aria-label={label} aria-describedby={helperId} autoFocus readOnly={locked} disabled={success}
          state={success ? 'success' : error ? 'error' : 'idle'} />
      )}
      <div className={slot('ba-code-status')}>
        <span className={slot('ba-code-verifying')} role="status" aria-busy={verifying && !success || undefined}>
          {success ? <><CodeSuccess />{t('codeInput.verified')}</> : <Busy busy={verifying} label={t('common.verifying')}>{null}</Busy>}
        </span>
        {mode === 'otp' && canUseEmailOtp && (
          <button type="button" className={slot('ba-link-button')} disabled={blocked} aria-busy={resend.pending || undefined} onClick={requestOtp}>
            {t('mfa.challenge.resendOtp')}
          </button>
        )}
      </div>
      {mode !== 'backup' && <p id={helperId} className={slot('ba-method-help')}>{t('codeInput.autoSubmitHint')}</p>}
      {mode !== 'backup' && canTrustDevice && (
        <label className={slot('ba-consent ba-consent-centered ba-factor-trust')}>
          <span className={slot('ba-checkbox-control')}>
            <input className={slot('ba-checkbox')} type="checkbox" checked={trustDevice} disabled={blocked} onChange={(e) => setTrustDevice(e.target.checked)} />
            <span className={slot('ba-checkbox-visual')} aria-hidden="true">
              <span className={slot('ba-checkbox-check')} />
            </span>
          </span>
          <span>{t('mfa.challenge.trustDevice', { days: 30 })}</span>
        </label>
      )}
      <FormError>{error}</FormError>
      {(mode === 'backup' || verifyError && retryVerify) && (
        <button className={slot('ba-button')} type="submit" disabled={blocked || !code} aria-busy={verifying || undefined}>
          <Busy busy={verifying} label={t('common.verifying')}>{t('mfa.challenge.submit')}</Busy>
        </button>
      )}
      <div className={slot('ba-factor-options')} role="group" aria-labelledby={otherWaysId}>
        <span id={otherWaysId}>{t('mfa.challenge.otherWays')}</span>
        <div className={slot('ba-factor-chips')}>
          {([
            { factor: 'totp', label: t('userProfile.mfa.authenticator'), show: true, select: () => switchMode('totp') },
            { factor: 'backup', label: t('mfa.challenge.backupLabel'), show: true, select: () => switchMode('backup') },
            { factor: 'otp', label: t('mfa.challenge.otpLabel'), show: canUseEmailOtp, select: requestOtp },
          ] as const).filter(({ factor, show }) => factor !== mode && show).map(({ factor, label: factorLabel, select }) => (
            <button key={factor} type="button" className={slot('ba-factor-chip')} disabled={blocked} onClick={select}>
              <FactorIcon factor={factor} />{factorLabel}
            </button>
          ))}
        </div>
      </div>
      {onCancel && (
        <button type="button" className={slot('ba-link-button')} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      )}
    </form>
  );
}
