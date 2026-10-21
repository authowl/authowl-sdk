'use client';
import { ProfileSectionFrame } from './ProfileSectionFrame';
import { useSlot } from '../../elements';
import * as React from 'react';
import { useAccount, useUser } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';

export function EmailSection({ allowChange }: { allowChange: boolean }) {
  const t = useT();
  const { user } = useUser();
  return (
    <ProfileSectionFrame section="email" title={t('userProfile.email.title')} meta={!user?.email ? t('userProfile.email.unavailable') : <><Bidi>{user.email}</Bidi>{!allowChange && <span data-testid="email-change-disabled"> · {t('userProfile.email.changeDisabled')}</span>}</>} action={t('userProfile.edit')}>
      {user?.email && allowChange ? <EmailSectionContent /> : null}
    </ProfileSectionFrame>
  );
}

function EmailSectionContent() {
  const slot = useSlot();
  const t = useT();
  const account = useAccount();
  const { user } = useUser();
  const { pending, error, run } = useSubmitAction();
  const [newEmail, setNewEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);

  if (!user?.email) return null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSent(false);
    void run(
      () => account.changeEmail({
        newEmail: newEmail.trim(),
        callbackURL: typeof window === 'undefined' ? undefined : window.location.href,
      }),
      {
        failure: t('userProfile.email.error'),
        onSuccess: () => {
          setSent(true);
          setNewEmail('');
        },
      },
    );
  };

  return (
    <>
      <p className={slot('ba-muted')}>{t('userProfile.email.description')}</p>
      <p className={slot('ba-profile-current')}>
        <span>{t('userProfile.email.current')}</span>
        <strong><Bidi>{user.email}</Bidi></strong>
      </p>
      <form method="post" className={slot('ba-fields')} onSubmit={submit}>
        <label className={slot('ba-label')}>
          {t('userProfile.email.newLabel')}
          <input
            className={slot('ba-input')}
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <FormError>{error}</FormError>
        {sent && <p className={slot('ba-success')} role="status">{t('userProfile.email.sent')}</p>}
        <button
          className={slot('ba-button ba-profile-submit')}
          type="submit"
          disabled={pending || !newEmail.trim()}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.sending')}>{t('userProfile.email.submit')}</Busy>
        </button>
      </form>
    </>
  );
}
