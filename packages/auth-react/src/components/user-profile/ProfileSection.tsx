'use client';
import * as React from 'react';
import { useAccount, useSession, useUser } from '../../hooks';
import { useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';

export function ProfileSection({
  firstLastName,
  usernameEnabled,
  legacyNameField,
}: {
  firstLastName: boolean;
  usernameEnabled: boolean;
  legacyNameField: boolean;
}) {
  const t = useT();
  const account = useAccount();
  const { user } = useUser();
  const session = useSession();
  const { pending, error, run } = useSubmitAction();
  const [name, setName] = React.useState(user?.name ?? '');
  const [firstName, setFirstName] = React.useState(user?.firstName ?? '');
  const [lastName, setLastName] = React.useState(user?.lastName ?? '');
  const [username, setUsername] = React.useState(
    user?.displayUsername ?? user?.username ?? '',
  );
  const [image, setImage] = React.useState(user?.image ?? '');
  const [saved, setSaved] = React.useState(false);
  const titleId = React.useId();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    void run(
      () => account.updateProfile({
        ...(legacyNameField ? { name: name.trim() } : {}),
        ...(firstLastName
          ? {
              ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
              ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
            }
          : {}),
        ...(usernameEnabled && username.trim() ? { username: username.trim() } : {}),
        image: image.trim() || null,
      }),
      {
        failure: t('userProfile.profile.error'),
        onSuccess: () => {
          setSaved(true);
          session.refetch({ query: { disableCookieCache: true } });
        },
      },
    );
  };

  return (
    <section className="ba-profile-section" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">
          {t('userProfile.profile.title')}
        </h2>
        <p className="ba-muted">{t('userProfile.profile.description')}</p>
      </header>
      <form method="post" className="ba-fields" onSubmit={submit}>
        {legacyNameField && (
          <label className="ba-label">
            {t('signUp.nameLabel')}
            <input
              className="ba-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}
        {firstLastName && (
          <>
            <label className="ba-label">
              {t('signUp.firstNameLabel')}
              <input
                className="ba-input"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="given-name"
              />
            </label>
            <label className="ba-label">
              {t('signUp.lastNameLabel')}
              <input
                className="ba-input"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="family-name"
              />
            </label>
          </>
        )}
        {usernameEnabled && (
          <label className="ba-label">
            {t('common.usernameLabel')}
            <input
              className="ba-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
        )}
        <label className="ba-label">
          {t('userProfile.profile.imageLabel')}
          <input
            className="ba-input"
            value={image}
            onChange={(event) => setImage(event.target.value)}
            inputMode="url"
            placeholder="https://"
          />
        </label>
        <FormError>{error}</FormError>
        {saved && <p className="ba-success" role="status">{t('userProfile.profile.saved')}</p>}
        <button
          className="ba-button ba-profile-submit"
          type="submit"
          disabled={pending || (legacyNameField && !name.trim())}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.working')}>{t('userProfile.save')}</Busy>
        </button>
      </form>
    </section>
  );
}
