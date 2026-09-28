'use client';
import * as React from 'react';
import type { Organization } from '@authowl/core';
import { useAuthClient, usePublicConfig, useSession, useUser } from '../hooks';
import { Bidi, useT } from '../i18n';
import { CreateOrganization } from './CreateOrganization';
import { OrganizationModal } from './organization/OrganizationModal';
import { IncomingInvitations } from './organization/IncomingInvitations';
import { useOrganizationsResource } from './organization/use-organizations-resource';
import { OrganizationProfile } from './OrganizationProfile';
import { useSubmitAction } from './use-submit-action';
import { FormError } from './FormError';

export type OrganizationListContentProps = {
  onOrganizationChange?: (organization: Organization | null) => void;
};

export function OrganizationListContent({ onOrganizationChange }: OrganizationListContentProps = {}) {
  const t = useT();
  const { config, isLoading: configLoading } = usePublicConfig();
  const { isLoaded, isSignedIn } = useUser();
  const session = useSession();
  const api = useAuthClient().organization;
  const enabled = config?.organizations === true && isSignedIn;
  const { organizations, isLoading, error: organizationError, refresh } = useOrganizationsResource(enabled);
  const { pending, error, run } = useSubmitAction();
  const [dialog, setDialog] = React.useState<'create' | 'profile' | null>(null);
  const [profileId, setProfileId] = React.useState<string | null>(null);
  const dialogReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const activeId = session.data?.session.activeOrganizationId ?? null;

  if (configLoading || !isLoaded) return <div className="ba-skeleton" aria-label={t('organization.loading')} />;
  if (config?.organizations !== true) return null;
  if (!isSignedIn) return <p className="ba-muted">{t('organization.signedOut')}</p>;

  const setActive = (organization: Organization) => {
    void run(
      () => api.setActive({ organizationId: organization.id }),
      {
        failure: t('organization.switcher.error'),
        onSuccess: async () => {
          await session.refetch({ query: { disableCookieCache: true } });
          onOrganizationChange?.(organization);
        },
      },
    );
  };

  const openProfile = (organization: Organization, trigger: HTMLElement) => {
    dialogReturnFocusRef.current = trigger;
    setProfileId(organization.id);
    setDialog('profile');
  };

  const afterProfileRemoval = async () => {
    await refresh();
    await session.refetch({ query: { disableCookieCache: true } });
    setDialog(null);
    setProfileId(null);
  };

  return (
    <>
      <section className="ba-organization-directory">
        <header className="ba-organization-directory-header">
          <span><h2 className="ba-title">{t('organization.list.title')}</h2><p className="ba-muted">{t('organization.list.description')}</p></span>
          <button className="ba-button" type="button" onClick={(event) => { dialogReturnFocusRef.current = event.currentTarget; setDialog('create'); }}>{t('organization.switcher.create')}</button>
        </header>
        {(organizationError || error) && (
          <div className="ba-inline-error">
            <FormError>{organizationError ?? error}</FormError>
            {organizationError && <button className="ba-link-button" type="button" onClick={() => void refresh()}>{t('organization.retry')}</button>}
          </div>
        )}
        {/* A failed load is not an empty directory. Rendering the empty copy
            under the error told the user they belong to no organization, which
            is a claim this component cannot make when the request never
            answered - and the retry beside the error is the actual next step. */}
        {isLoading ? <div className="ba-organization-card-grid"><div className="ba-skeleton" /><div className="ba-skeleton" /></div> : organizations?.length ? (
          <ul className="ba-organization-card-grid">
            {organizations.map((organization) => (
              <li key={organization.id} className="ba-organization-card">
                <span className="ba-organization-avatar ba-organization-avatar-large" aria-hidden="true">{organization.name.trim().charAt(0).toUpperCase() || '?'}</span>
                <span className="ba-organization-card-copy"><strong>{organization.name}</strong><small><Bidi>{organization.slug}</Bidi></small></span>
                {activeId === organization.id && <span className="ba-organization-active">{t('organization.list.active')}</span>}
                <span className="ba-organization-card-actions">
                  {activeId !== organization.id && <button className="ba-button ba-button-secondary" type="button" disabled={pending} onClick={() => setActive(organization)}>{t('organization.list.switch')}</button>}
                  <button className="ba-link-button" type="button" onClick={(event) => openProfile(organization, event.currentTarget)}>{t('organization.list.manage')}</button>
                </span>
              </li>
            ))}
          </ul>
        ) : organizationError ? null : <p className="ba-muted">{t('organization.list.empty')}</p>}

        <IncomingInvitations onChanged={refresh} />
      </section>
      {dialog === 'create' && (
        <OrganizationModal title={t('organization.create.title')} returnFocusRef={dialogReturnFocusRef} onClose={() => setDialog(null)}>
          <CreateOrganization title={null} onCreated={() => { void (async () => { await refresh(); await session.refetch({ query: { disableCookieCache: true } }); setDialog(null); })(); }} />
        </OrganizationModal>
      )}
      {dialog === 'profile' && profileId && (
        <OrganizationModal title={t('organization.profile.title')} returnFocusRef={dialogReturnFocusRef} onClose={() => setDialog(null)}>
          <OrganizationProfile organizationId={profileId} onDeleted={() => void afterProfileRemoval()} onLeft={() => void afterProfileRemoval()} />
        </OrganizationModal>
      )}
    </>
  );
}
