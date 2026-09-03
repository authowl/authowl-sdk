'use client';
import * as React from 'react';
import {
  createIdempotencyKey,
  solvePhoneOtpChallenge,
  type PhoneOtpChallengeData,
} from '@authowl/core';
import { useAuthClient, usePublicConfig, useSignIn } from '../hooks';
import { Bidi, useT } from '../i18n';
import { finishSignIn } from './finish-sign-in';
import { LegalConsentCheckbox } from './LegalConsentCheckbox';
import { Turnstile } from './Turnstile';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type PhoneOTPProps = {
  redirectTo?: string;
  onSignedIn?: () => void;
  /** Forwarded to {@link finishSignIn}; see its `interstitial`. */
  interstitial?: () => Promise<void>;
  /** Optional navigation affordance when embedded in another sign-in surface. */
  onBack?: () => void;
  /** Called when this phone belongs to an account that must use password + MFA. */
  onMfaPasswordRequired?: () => void;
};

type SendAttempt = { phoneNumber: string; idempotencyKey: string };
type GuardState =
  | { status: 'loading' }
  | { status: 'ready'; data: PhoneOtpChallengeData }
  | { status: 'error' };

/** Egyptian phone sign-in with managed Turnstile, retry-safe send, and code verification. */
export function PhoneOTP({
  redirectTo,
  onSignedIn,
  interstitial,
  onBack,
  onMfaPasswordRequired,
}: PhoneOTPProps) {
  const t = useT();
  const { sessionStore } = useAuthClient();
  const { config, isLoading } = usePublicConfig();
  const { preparePhoneOtp, startPhoneOtp, verifyPhoneOtp } = useSignIn();
  const { pending, error, setError, run } = useSubmitAction();
  const [stage, setStage] = React.useState<'phone' | 'code'>('phone');
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [code, setCode] = React.useState('');
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const [guardState, setGuardState] = React.useState<GuardState>({ status: 'loading' });
  const [accepted, setAccepted] = React.useState(false);
  const attempt = React.useRef<SendAttempt | null>(null);
  const guardRequest = React.useRef(0);
  const legal = config?.legal;
  const consentBlocked = Boolean(legal?.required && !accepted);
  const guard = guardState.status === 'ready' ? guardState.data : null;
  const turnstileBlocked = guardState.status === 'ready'
    && guardState.data.kind === 'authowl_turnstile'
    && !turnstileToken;
  const humanCheckError = t('phoneOtp.error.humanCheck');

  const loadGuard = React.useCallback(async () => {
    const request = ++guardRequest.current;
    setGuardState({ status: 'loading' });
    setError(null);
    try {
      const result = await preparePhoneOtp();
      if (request !== guardRequest.current) return;
      if (result.error || !result.data) {
        setGuardState({ status: 'error' });
        setError(humanCheckError);
        return;
      }
      setGuardState({ status: 'ready', data: result.data });
    } catch {
      if (request !== guardRequest.current) return;
      setGuardState({ status: 'error' });
      setError(humanCheckError);
    }
  }, [humanCheckError, preparePhoneOtp, setError]);

  React.useEffect(() => {
    void loadGuard();
    return () => { guardRequest.current += 1; };
  }, [loadGuard]);

  if (isLoading) {
    return (
      <div className="ba-fields" data-testid="phoneotp-loading" aria-busy="true">
        <div className="ba-skeleton" />
        <div className="ba-skeleton" />
      </div>
    );
  }

  if (stage === 'code') {
    return (
      <form
        method="post"
        className="ba-fields"
        data-testid="phoneotp-code"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () =>
              verifyPhoneOtp({
                phoneNumber,
                code,
                consentVersion: legal?.required ? legal.version : undefined,
              }),
            {
              failure: t('phoneOtp.error.invalidCode'),
              mapError: (authError) => {
                if (authError.code === 'TWO_FACTOR_REQUIRED') {
                  onMfaPasswordRequired?.();
                }
                return null;
              },
              onSuccess: () => finishSignIn({ sessionStore, redirectTo, onSignedIn, interstitial }),
            },
          );
        }}
      >
        <h2 className="ba-title">{t('phoneOtp.title')}</h2>
        <label className="ba-label">
          {t('phoneOtp.codeLabel')} <Bidi>{phoneNumber}</Bidi>
          <input
            className="ba-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            minLength={6}
            maxLength={6}
            autoFocus
            required
          />
        </label>
        <FormError>{error}</FormError>
        <button
          className="ba-button"
          type="submit"
          disabled={pending || code.length !== 6}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.verifying')}>{t('phoneOtp.verifySubmit')}</Busy>
        </button>
        <button
          type="button"
          className="ba-link-button"
          onClick={() => {
            setStage('phone');
            setCode('');
            setError(null);
            attempt.current = null;
          }}
        >
          {t('phoneOtp.changePhone')}
        </button>
      </form>
    );
  }

  return (
    <form
      method="post"
      className="ba-fields"
      data-testid="phoneotp-phone"
      onSubmit={(event) => {
        event.preventDefault();
        if (consentBlocked) {
          setError(t('signUp.error.consentRequired'));
          return;
        }
        // No guard yet means the challenge lookup is still in flight or failed.
        // Report the human-check error rather than falling through to the
        // generic "send failed" the submit path would otherwise produce.
        if (!guard || (guard.kind === 'authowl_turnstile' && !turnstileToken)) {
          setError(t('phoneOtp.error.humanCheck'));
          return;
        }
        if (!attempt.current || attempt.current.phoneNumber !== phoneNumber) {
          attempt.current = { phoneNumber, idempotencyKey: createIdempotencyKey() };
        }
        const idempotencyKey = attempt.current.idempotencyKey;
        void run(
          async () => {
            const selected = guard?.kind === 'akedly_shield_v1_2'
              ? await preparePhoneOtp()
              : null;
            if (selected?.error || (selected && !selected.data)) {
              setGuardState({ status: 'error' });
              throw new Error('Phone OTP guard could not be prepared.');
            }
            const current = selected?.data ?? guard;
            if (selected?.data) setGuardState({ status: 'ready', data: selected.data });
            if (current?.kind === 'akedly_shield_v1_2') {
              const akedlyShield = await solvePhoneOtpChallenge(current);
              return startPhoneOtp({ phoneNumber, akedlyShield, idempotencyKey });
            }
            if (current?.kind === 'authowl_turnstile' && turnstileToken) {
              return startPhoneOtp({ phoneNumber, turnstileToken, idempotencyKey });
            }
            throw new Error('Phone OTP guard is unavailable.');
          },
          {
            failure: t('phoneOtp.error.sendFailed'),
            onSuccess: () => setStage('code'),
          },
        );
      }}
    >
      <h2 className="ba-title">{t('phoneOtp.title')}</h2>
      <label className="ba-label">
        {t('phoneOtp.phoneLabel')}
        <input
          className="ba-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="01xxxxxxxxx"
          value={phoneNumber}
          onChange={(event) => {
            setPhoneNumber(event.target.value);
            attempt.current = null;
          }}
          required
        />
      </label>
      {legal && (
        <LegalConsentCheckbox
          legal={legal}
          accepted={accepted}
          onAcceptedChange={setAccepted}
          testId="phoneotp-consent"
        />
      )}
      {guard?.kind === 'authowl_turnstile' && (
        <Turnstile
          siteKey={config?.turnstileSiteKey ?? null}
          theme={config?.branding.theme ?? 'system'}
          onToken={setTurnstileToken}
          onUnavailable={() => setError(t('phoneOtp.error.humanCheck'))}
        />
      )}
      <FormError>{error}</FormError>
      {guardState.status === 'error' && (
        <button
          type="button"
          className="ba-link-button"
          onClick={() => { void loadGuard(); }}
        >
          {t('phoneOtp.retryHumanCheck')}
        </button>
      )}
      <button
        className="ba-button"
        type="submit"
        // Stays disabled until the server has told us which challenge applies:
        // `guard === null` is "unknown", not "no challenge required".
        disabled={
          pending
          || guardState.status !== 'ready'
          || turnstileBlocked
          || consentBlocked
        }
        aria-busy={pending || undefined}
      >
        <Busy busy={pending} label={t('common.sending')}>{t('phoneOtp.sendSubmit')}</Busy>
      </button>
      {onBack && (
        <button type="button" className="ba-link-button" onClick={onBack}>
          {t('phoneOtp.backToSignIn')}
        </button>
      )}
    </form>
  );
}
