'use client';
import * as React from 'react';
import { useMFA, useUser } from '../hooks';
import { useT } from '../i18n';
import { useStepUpAction } from './use-step-up-action';
import { MFAChallenge } from './MFAChallenge';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type BackupCodesManagerProps = {
  /** Optional heading; pass null to hide it. */
  title?: string | null;
};

/**
 * Backup-codes management (B.5d): regenerate the signed-in user's single-use
 * backup codes and show the new set ONCE. Renders nothing for users without 2FA
 * enrolled - mount it unconditionally in an account/security page alongside
 * <MFAEnrollment/>.
 *
 * Reissuing codes retires the old set, so the server treats it as a weakening
 * action and can demand a second-factor proof on top of the password. That
 * arrives as a code prompt and the request finishes on its own - see
 * {@link useStepUpAction}.
 */
export function BackupCodesManager({ title }: BackupCodesManagerProps) {
  const t = useT();
  const { user } = useUser();
  const { regenerateBackupCodes } = useMFA();
  const { pending, error, stepUpRequired, run, resume, cancel } = useStepUpAction();
  const [password, setPassword] = React.useState('');
  const [codes, setCodes] = React.useState<string[] | null>(null);

  if (!user?.twoFactorEnabled) return null;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void run(() => regenerateBackupCodes({ password }), {
      failure: t('backupCodes.error.failed'),
      onSuccess: (res) => {
        setCodes(res.data?.backupCodes ?? null);
        setPassword('');
      },
    });
  };

  return (
    <div className="ba-form" data-testid="backup-codes-manager">
      {title !== null && <h2 className="ba-title">{title ?? t('backupCodes.title')}</h2>}
      <p className="ba-muted">{t('backupCodes.hint')}</p>
      {codes ? (
        <>
          <p className="ba-muted">
            <strong>{t('mfa.enroll.backupCodesWarningStrong')}</strong>{' '}
            {t('mfa.enroll.backupCodesWarningRest')}
          </p>
          <ul className="ba-passkey-list" data-testid="backup-codes-list">
            {codes.map((c) => (
              <li key={c} className="ba-passkey-item">
                <code>
                  <bdi>{c}</bdi>
                </code>
              </li>
            ))}
          </ul>
        </>
      ) : stepUpRequired ? (
        <MFAChallenge variant="step-up" onVerified={resume} onCancel={cancel} />
      ) : (
        <form method="post" className="ba-fields" onSubmit={submit}>
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
            <Busy busy={pending} label={t('backupCodes.pending')}>{t('backupCodes.submit')}</Busy>
          </button>
        </form>
      )}
    </div>
  );
}
