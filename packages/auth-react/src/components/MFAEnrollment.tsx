'use client';
import * as React from 'react';
import type { TwoFactorEnableData } from '@authowl/core';
import { useMFA, useUser } from '../hooks';
import { useT, richMessage, Bidi } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { shouldDiscardSetup } from './mfa-enrollment';
import { QrCode } from './QrCode';
import { FormError } from './FormError';

export type MFAEnrollmentProps = {
  /** Called once the factor is verified and active. */
  onEnrolled?: () => void;
  /** Heading text; pass `null` when a parent section owns the heading. */
  title?: string | null;
};

/** Pull the base32 secret out of an otpauth URI for the manual-entry fallback. */
function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get('secret');
  } catch {
    return null;
  }
}

/**
 * TOTP enrolment for the signed-in user: confirm the password, scan the QR (or
 * enter the secret manually) into an authenticator app, save the one-time backup
 * codes, then verify a live code to activate. The factor is NOT active until that
 * final verification, so an abandoned setup never half-enrols the account.
 */
export function MFAEnrollment({ onEnrolled, title }: MFAEnrollmentProps) {
  const t = useT();
  const { enable, verifyTotp } = useMFA();
  const { user, isLoaded } = useUser();
  const { pending, error, run } = useSubmitAction();
  const [password, setPassword] = React.useState('');
  const [setup, setSetup] = React.useState<TwoFactorEnableData | null>(null);
  const [code, setCode] = React.useState('');
  const [done, setDone] = React.useState(false);
  // The account that started the current setup. If the signed-in identity changes
  // (sign-out / account switch) while this stays mounted, drop the in-flight TOTP
  // URI + backup codes so one account's secrets never linger for another session.
  const setupOwnerId = React.useRef<string | null>(null);
  const userId = user?.id ?? null;

  // Decide at RENDER time whether the in-flight setup still belongs to who's
  // signed in. When it doesn't, treat it as absent immediately (activeSetup=null)
  // so the previous user's secrets are never painted for the new one - not even
  // for the one frame a post-commit effect would allow. The effect then clears the
  // stale state; a benign same-user refetch keeps the id so the flow is undisturbed.
  const stale = shouldDiscardSetup({
    isLoaded,
    hasSetup: setup !== null,
    setupOwnerId: setupOwnerId.current,
    currentUserId: userId,
  });
  const activeSetup = stale ? null : setup;
  React.useEffect(() => {
    if (stale) {
      setSetup(null);
      setPassword('');
      setCode('');
    }
  }, [stale]);

  // Terminal success: the factor is now active. Reached only after a live code
  // verified, with the secrets already cleared, so the drop-in component stops
  // showing the QR/backup codes even when no `onEnrolled` navigation is provided.
  if (done) {
    return (
      <div className="ba-fields" data-testid="mfa-enroll-done">
        <h2 className="ba-title">{t('mfa.enroll.doneTitle')}</h2>
        <p className="ba-muted">{t('mfa.enroll.doneBody')}</p>
      </div>
    );
  }

  // Before enrolment begins, the user's current state decides what to show.
  if (!activeSetup) {
    // Wait for the session so we can tell whether they're already enrolled.
    if (!isLoaded) {
      return (
        <div className="ba-fields" data-testid="mfa-enroll-loading" aria-busy="true">
          <div className="ba-skeleton" />
        </div>
      );
    }
    // Already enrolled: re-running /enable would rotate the live secret and lock
    // out the existing authenticator, so we refuse and point at disable instead.
    if (user?.twoFactorEnabled) {
      return (
        <div className="ba-fields" data-testid="mfa-enroll-active">
          <h2 className="ba-title">{t('mfa.enroll.activeTitle')}</h2>
          <p className="ba-muted">{t('mfa.enroll.activeBody')}</p>
        </div>
      );
    }

    // Step 1: confirm the password to begin enrolment (BA gates /enable on it).
    return (
      <form
        method="post"
        className="ba-fields"
        data-testid="mfa-enroll-password"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => enable({ password }), {
            failure: t('mfa.enroll.error.startFailed'),
            onSuccess: (res) => {
              setupOwnerId.current = userId; // bind these secrets to the current account
              setSetup(res.data);
            },
          });
        }}
      >
        {title !== null && <h2 className="ba-title">{title ?? t('mfa.enroll.title')}</h2>}
        <p className="ba-muted">{t('mfa.enroll.passwordHint')}</p>
        <label className="ba-label">
          {t('common.passwordLabel')}
          <input
            className="ba-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <FormError>{error}</FormError>
        <button className="ba-button" type="submit" disabled={pending || !password} aria-busy={pending || undefined}>
          <Busy busy={pending} label={t('mfa.enroll.startPending')}>{t('common.continue')}</Busy>
        </button>
      </form>
    );
  }

  // Step 2: show the QR + backup codes (once), then verify a live code to activate.
  const secret = secretFromUri(activeSetup.totpURI);
  return (
    <div className="ba-fields" data-testid="mfa-enroll-verify">
      <h2 className="ba-title">{t('mfa.enroll.scanQrTitle')}</h2>
      <p className="ba-muted">{t('mfa.enroll.scanQrHint')}</p>
      <QrCode value={activeSetup.totpURI} />
      {secret && (
        <p className="ba-muted">
          {richMessage(t('mfa.enroll.manualKey'), {
            secret: (
              <code className="ba-code">
                <Bidi>{secret}</Bidi>
              </code>
            ),
          })}
        </p>
      )}

      <div>
        <p className="ba-muted">
          <strong>{t('mfa.enroll.backupCodesWarningStrong')}</strong>{' '}
          {t('mfa.enroll.backupCodesWarningRest')}
        </p>
        <ul className="ba-backup-codes" data-testid="mfa-backup-codes">
          {activeSetup.backupCodes.map((c) => (
            <li key={c}>
              <code className="ba-code">{c}</code>
            </li>
          ))}
        </ul>
      </div>

      <form
        method="post"
        className="ba-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => verifyTotp({ code }), {
            failure: t('mfa.enroll.error.invalidCode'),
            onSuccess: () => {
              // Reach a terminal state: drop the secrets from memory/screen, then
              // hand off. Works whether or not `onEnrolled` navigates away.
              setSetup(null);
              setCode('');
              setDone(true);
              onEnrolled?.();
            },
          });
        }}
      >
        <label className="ba-label">
          {t('mfa.enroll.codeLabel')}
          <input
            className="ba-input"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </label>
        <FormError>{error}</FormError>
        <button className="ba-button" type="submit" disabled={pending || !code} aria-busy={pending || undefined}>
          <Busy busy={pending} label={t('common.verifying')}>{t('mfa.enroll.activateSubmit')}</Busy>
        </button>
      </form>
    </div>
  );
}
