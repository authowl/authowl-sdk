'use client';
import { useSlot } from '../../elements';
import * as React from 'react';
import { useAccount, useUser } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';

export function EmailSection({ allowChange }: { allowChange: boolean }) {
  const slot = useSlot();
  const t = useT();
  const account = useAccount();
  const { user } = useUser();
  const { pending, error, run } = useSubmitAction();
  const [newEmail, setNewEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const titleId = React.useId();

  if (!user?.email) {
    return (
      <section className={slot('ba-profile-section')} aria-labelledby={titleId}>
        <h2 id={titleId} className={slot('ba-title')}>{t('userProfile.email.title')}</h2>
        <p className={slot('ba-muted')}>{t('userProfile.email.unavailable')}</p>
      </section>
    );
  }

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
    <section className={slot('ba-profile-section')} aria-labelledby={titleId}>
      <header className={slot('ba-profile-section-header')}>
        <h2 id={titleId} className={slot('ba-title')}>{t('userProfile.email.title')}</h2>
        <p className={slot('ba-muted')}>{t('userProfile.email.description')}</p>
      </header>
      <p className={slot('ba-profile-current')}>
        <span>{t('userProfile.email.current')}</span>
        <strong><Bidi>{user.email}</Bidi></strong>
      </p>
      {!allowChange ? (
        <p className={slot('ba-muted')} data-testid="email-change-disabled">
          {t('userProfile.email.changeDisabled')}
        </p>
      ) : <form method="post" className={slot('ba-fields')} onSubmit={submit}>
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
      </form>}
    </section>
  );
}
