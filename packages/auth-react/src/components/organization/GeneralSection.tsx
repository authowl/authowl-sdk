'use client';
import * as React from 'react';
import type { OrganizationDetails } from '@authowl/core';
import { useAuthClient } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { organizationSlugFromName } from './model';
import { FormError } from '../FormError';

export function GeneralSection({
  organization,
  canManage,
  onChanged,
}: {
  organization: OrganizationDetails;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const api = useAuthClient().organization;
  const { pending, error, run } = useSubmitAction();
  const [name, setName] = React.useState(organization.name);
  const [slug, setSlug] = React.useState(organization.slug);
  const [logo, setLogo] = React.useState(organization.logo ?? '');

  React.useEffect(() => {
    setName(organization.name);
    setSlug(organization.slug);
    setLogo(organization.logo ?? '');
  }, [organization.id, organization.logo, organization.name, organization.slug]);

  if (!canManage) {
    return (
      <section className="ba-organization-section">
        <p className="ba-muted">{t('organization.profile.general.readOnly')}</p>
        <dl className="ba-organization-facts">
          <div><dt>{t('organization.create.name')}</dt><dd>{organization.name}</dd></div>
          <div><dt>{t('organization.create.slug')}</dt><dd><Bidi>{organization.slug}</Bidi></dd></div>
        </dl>
      </section>
    );
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(
      () => api.update({
        organizationId: organization.id,
        data: { name: name.trim(), slug: slug.trim(), logo: logo.trim() || null },
      }),
      {
        failure: t('organization.profile.general.error'),
        onSuccess: onChanged,
      },
    );
  };

  return (
    <section className="ba-organization-section">
      <header className="ba-organization-section-header">
        <h3 className="ba-title">{t('organization.profile.general.title')}</h3>
        <p className="ba-muted">{t('organization.profile.general.description')}</p>
      </header>
      <form method="post" className="ba-fields" onSubmit={submit}>
        <label className="ba-label">
          {t('organization.create.name')}
          <input className="ba-input" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="ba-label">
          {t('organization.create.slug')}
          <input
            className="ba-input"
            dir="ltr"
            value={slug}
            onChange={(event) => setSlug(organizationSlugFromName(event.target.value))}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
        </label>
        <label className="ba-label">
          {t('organization.create.logo')}
          <input className="ba-input" type="url" dir="ltr" value={logo} onChange={(event) => setLogo(event.target.value)} placeholder="https://" />
        </label>
        <FormError>{error}</FormError>
        <button
          className="ba-button ba-profile-submit"
          type="submit"
          disabled={pending || !name.trim() || !slug.trim()}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.working')}>{t('organization.profile.general.save')}</Busy>
        </button>
      </form>
    </section>
  );
}
