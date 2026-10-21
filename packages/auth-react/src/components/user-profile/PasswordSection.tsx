'use client';
import { ProfileSectionDisclosure } from './ProfileSectionShell';
import { useSlot } from '../../elements';
import * as React from 'react';
import { useAccount } from '../../hooks';
import { useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';

type PasswordPolicy = { passwordMinLength: number; passwordMaxLength: number };

export function PasswordSection(policy: PasswordPolicy) {
  return (
    <ProfileSectionDisclosure section="password">
      <PasswordSectionContent {...policy} />
    </ProfileSectionDisclosure>
  );
}

function PasswordSectionContent({ passwordMinLength, passwordMaxLength }: PasswordPolicy) {
  const slot = useSlot();
  const t = useT();
  const account = useAccount();
  const { pending, error, setError, run } = useSubmitAction();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [saved, setSaved] = React.useState(false);

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
    <>
      <form method="post" className={slot('ba-fields')} onSubmit={submit}>
        <label className={slot('ba-label')}>
          {t('userProfile.password.currentLabel')}
          <input className={slot('ba-input')} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError(null); }} required />
        </label>
        <label className={slot('ba-label')}>
          {t('resetPassword.newPasswordLabel')}
          <input className={slot('ba-input')} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(null); }} minLength={passwordMinLength} maxLength={passwordMaxLength} required />
        </label>
        <label className={slot('ba-label')}>
          {t('resetPassword.confirmPasswordLabel')}
          <input className={slot('ba-input')} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(null); }} minLength={passwordMinLength} maxLength={passwordMaxLength} required />
        </label>
        <FormError>{error}</FormError>
        {saved && <p className={slot('ba-success')} role="status">{t('userProfile.password.saved')}</p>}
        <button
          className={slot('ba-button ba-profile-submit')}
          type="submit"
          disabled={pending || !currentPassword || !newPassword || !confirmPassword}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.working')}>{t('userProfile.password.submit')}</Busy>
        </button>
      </form>
    </>
  );
}
