'use client';
import * as React from 'react';
import { useAccount, usePublicConfig } from '../../hooks';
import { resolveProjectCapabilities } from '../../project-capabilities';
import { useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';

export function PasswordSection() {
  const t = useT();
  const account = useAccount();
  const { config } = usePublicConfig();
  const { passwordMinLength, passwordMaxLength } = resolveProjectCapabilities(config);
  const { pending, error, setError, run } = useSubmitAction();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const titleId = React.useId();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    if (newPassword.length < passwordMinLength) {
      setError(t('common.error.passwordTooShort', { min: passwordMinLength }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('resetPassword.error.mismatch'));
      return;
    }
    void run(
      () => account.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }),
      {
        failure: t('userProfile.password.error'),
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setSaved(true);
        },
      },
    );
  };

  return (
    <section className="ba-profile-section" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">{t('userProfile.password.title')}</h2>
        <p className="ba-muted">{t('userProfile.password.description')}</p>
      </header>
      <form method="post" className="ba-fields" onSubmit={submit}>
        <label className="ba-label">
          {t('userProfile.password.currentLabel')}
          <input className="ba-input" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError(null); }} required />
        </label>
        <label className="ba-label">
          {t('resetPassword.newPasswordLabel')}
          <input className="ba-input" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(null); }} minLength={passwordMinLength} maxLength={passwordMaxLength} required />
        </label>
        <label className="ba-label">
          {t('resetPassword.confirmPasswordLabel')}
          <input className="ba-input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(null); }} minLength={passwordMinLength} maxLength={passwordMaxLength} required />
        </label>
        <FormError>{error}</FormError>
        {saved && <p className="ba-success" role="status">{t('userProfile.password.saved')}</p>}
        <button
          className="ba-button ba-profile-submit"
          type="submit"
          disabled={pending || !currentPassword || !newPassword || !confirmPassword}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.working')}>{t('userProfile.password.submit')}</Busy>
        </button>
      </form>
    </section>
  );
}
