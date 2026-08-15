'use client';
import * as React from 'react';
import type { Organization, OrganizationUserInvitation } from '@authowl/core';
import { useAuthClient, usePublicConfig, useSession, useUser } from '../hooks';
import { Bidi, useServerError, useT } from '../i18n';
import { CreateOrganization } from './CreateOrganization';
import { OrganizationModal } from './organization/OrganizationModal';
import { organizationRoleLabel } from './organization/role-label';
import { useOrganizationsResource } from './organization/use-organizations-resource';
import { OrganizationProfile } from './OrganizationProfile';
import { useSubmitAction } from './use-submit-action';
import { FormError } from './FormError';

export type OrganizationListProps = {
  onOrganizationChange?: (organization: Organization | null) => void;
};

export function OrganizationList({ onOrganizationChange }: OrganizationListProps = {}) {
  const t = useT();
  const toServerError = useServerError();
  const { config, isLoading: configLoading } = usePublicConfig();
  const { user, isLoaded, isSignedIn } = useUser();
  const session = useSession();
  const api = useAuthClient().organization;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const enabled = config?.organizations === true && isSignedIn;
  const { organizations, isLoading, error: organizationError, refresh } = useOrganizationsResource(enabled);
  const { pending, error, run } = useSubmitAction();
  const [invitations, setInvitations] = React.useState<OrganizationUserInvitation[] | null>(null);
  const [invitationError, setInvitationError] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<'create' | 'profile' | null>(null);
  const [profileId, setProfileId] = React.useState<string | null>(null);
  const dialogReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const invitationRequestRef = React.useRef(0);
  const activeId = session.data?.session.activeOrganizationId ?? null;

  const loadInvitations = React.useCallback(async () => {
    const token = ++invitationRequestRef.current;
    if (!enabled) {
      setInvitations([]);
      setInvitationError(null);
      return;
    }
    try {
      const result = await apiRef.current.listUserInvitations();
      if (token !== invitationRequestRef.current) return;
      if (result.error) {
        setInvitationError(toServerError(result.error, t('organization.list.invitationsError')));
        return;
      }
      setInvitationError(null);
      setInvitations((result.data ?? []).filter((invitation) => invitation.status === 'pending'));
    } catch {
      if (token === invitationRequestRef.current) setInvitationError(t('organization.list.invitationsError'));
    }
  }, [enabled, t, toServerError]);

  React.useEffect(() => {
    setInvitations(null);
    setInvitationError(null);
    if (!isLoaded) return;
    void loadInvitations();
    return () => {
      invitationRequestRef.current += 1;
    };
  }, [isLoaded, loadInvitations, user?.id]);

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

  const invitationAction = (invitation: OrganizationUserInvitation, action: 'accept' | 'reject') => {
    const onSuccess = async () => {
      await Promise.all([refresh(), loadInvitations()]);
      if (action === 'accept') await session.refetch({ query: { disableCookieCache: true } });
    };
    if (action === 'accept') {
      void run(
        () => api.acceptInvitation({ invitationId: invitation.id }),
        { failure: t('organization.list.acceptError'), onSuccess },
      );
      return;
    }
    void run(
      () => api.rejectInvitation({ invitationId: invitation.id }),
      { failure: t('organization.list.rejectError'), onSuccess },
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
        ) : <p className="ba-muted">{t('organization.list.empty')}</p>}

        <section className="ba-organization-user-invitations">
          <header className="ba-organization-section-header"><h3 className="ba-title">{t('organization.list.invitationsTitle')}</h3><p className="ba-muted">{t('organization.list.invitationsDescription')}</p></header>
          {invitationError && <div className="ba-inline-error"><FormError>{invitationError}</FormError><button className="ba-link-button" type="button" onClick={() => void loadInvitations()}>{t('organization.retry')}</button></div>}
          {invitations === null && !invitationError ? <div className="ba-skeleton" /> : invitations?.length ? (
            <ul className="ba-organization-list">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="ba-organization-invitation">
                  <span><strong>{invitation.organizationName}</strong><small>{organizationRoleLabel(invitation.role, t)}</small></span>
                  <span className="ba-organization-card-actions">
                    <button className="ba-button" type="button" disabled={pending} onClick={() => invitationAction(invitation, 'accept')}>{t('organization.list.accept')}</button>
                    <button className="ba-link-button" type="button" disabled={pending} onClick={() => invitationAction(invitation, 'reject')}>{t('organization.list.reject')}</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="ba-muted">{t('organization.list.noInvitations')}</p>}
        </section>
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
