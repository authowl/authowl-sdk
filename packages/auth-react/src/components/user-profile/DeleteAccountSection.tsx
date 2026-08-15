'use client';
import * as React from 'react';
import { useAccount, useSession, useUser } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';

export function DeleteAccountSection({ onDeleted }: { onDeleted?: () => void }) {
  const t = useT();
  const account = useAccount();
  const session = useSession();
  const { user } = useUser();
  const { pending, error, run } = useSubmitAction();
  const [confirmation, setConfirmation] = React.useState('');
  const titleId = React.useId();
  const identifier = user?.email ?? user?.phoneNumber ?? user?.id ?? '';
  const confirmed = identifier.length > 0
    && confirmation.trim().toLowerCase() === identifier.toLowerCase();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed) return;
    void run(
      () => account.delete(),
      {
        failure: t('userProfile.delete.error'),
        onSuccess: () => {
          session.refetch({ query: { disableCookieCache: true } });
          onDeleted?.();
        },
      },
    );
  };

  return (
    <section className="ba-profile-section ba-profile-danger-zone" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">{t('userProfile.delete.title')}</h2>
        <p className="ba-muted">{t('userProfile.delete.description')}</p>
      </header>
      <form method="post" className="ba-fields" onSubmit={submit}>
        <p className="ba-profile-delete-warning">
          {t('userProfile.delete.warning', { identifier })}
        </p>
        <label className="ba-label">
          {t('userProfile.delete.confirmLabel')} <Bidi>{identifier}</Bidi>
          <input
            className="ba-input"
            type="text"
            dir="ltr"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <FormError>{error}</FormError>
        <button
          className="ba-button ba-danger-button ba-profile-submit"
          type="submit"
          disabled={pending || !confirmed}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.working')}>{t('userProfile.delete.submit')}</Busy>
        </button>
      </form>
    </section>
  );
}
