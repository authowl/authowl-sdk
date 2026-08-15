'use client';
import * as React from 'react';
import type { Organization } from '@authowl/core';
import { useAuthClient, usePublicConfig, useUser } from '../hooks';
import { useT } from '../i18n';
import { organizationSlugFromName } from './organization/model';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type CreateOrganizationProps = {
  onCreated?: (organization: Organization) => void;
  /** Hide the component heading when a surrounding dialog already supplies it. */
  title?: string | null;
};

export function CreateOrganization({ onCreated, title }: CreateOrganizationProps = {}) {
  const t = useT();
  const { config, isLoading: configLoading } = usePublicConfig();
  const { isLoaded, isSignedIn } = useUser();
  const api = useAuthClient().organization;
  const { pending, error, run } = useSubmitAction();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [logo, setLogo] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(false);

  if (configLoading || !isLoaded) {
    return <div className="ba-skeleton" aria-label={t('organization.loading')} />;
  }
  if (config?.organizations !== true) return null;
  if (!isSignedIn) return <p className="ba-muted">{t('organization.signedOut')}</p>;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedSlug = slug.trim();
    if (!normalizedName || !normalizedSlug) return;
    void run(
      () => api.create({
        name: normalizedName,
        slug: normalizedSlug,
        logo: logo.trim() || null,
      }),
      {
        failure: t('organization.create.error'),
        onSuccess: (result) => {
          if (!result.data) return;
          setName('');
          setSlug('');
          setLogo('');
          setSlugTouched(false);
          onCreated?.(result.data);
        },
      },
    );
  };

  return (
    <section className="ba-organization-create">
      {title !== null && (
        <header className="ba-organization-section-header">
          <h2 className="ba-title">{title ?? t('organization.create.title')}</h2>
          <p className="ba-muted">{t('organization.create.description')}</p>
        </header>
      )}
      <form method="post" className="ba-fields" onSubmit={submit}>
        <label className="ba-label">
          {t('organization.create.name')}
          <input
            className="ba-input"
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (!slugTouched) setSlug(organizationSlugFromName(next));
            }}
            autoComplete="organization"
            required
          />
        </label>
        <label className="ba-label">
          {t('organization.create.slug')}
          <input
            className="ba-input"
            dir="ltr"
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(organizationSlugFromName(event.target.value));
            }}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
        </label>
        <label className="ba-label">
          {t('organization.create.logo')}
          <input
            className="ba-input"
            type="url"
            dir="ltr"
            value={logo}
            onChange={(event) => setLogo(event.target.value)}
            placeholder="https://"
          />
        </label>
        <FormError>{error}</FormError>
        <button
          className="ba-button ba-profile-submit"
          type="submit"
          disabled={pending || !name.trim() || !slug.trim()}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.working')}>{t('organization.create.submit')}</Busy>
        </button>
      </form>
    </section>
  );
}
