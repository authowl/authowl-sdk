'use client';
import * as React from 'react';
import type { OrganizationDetails } from '@authowl/core';
import { useAuthClient, usePublicConfig, useSession, useUser } from '../hooks';
import { useServerError, useT, type MessageKey } from '../i18n';
import { DangerSection } from './organization/DangerSection';
import { GeneralSection } from './organization/GeneralSection';
import { InvitationsSection } from './organization/InvitationsSection';
import { MembersSection } from './organization/MembersSection';
import { canManageOrganization, type OrganizationProfileSection } from './organization/model';
import { FormError } from './FormError';

export type OrganizationProfileProps = {
  /** Organization to manage. Omitted means the active organization from the session. */
  organizationId?: string;
  defaultSection?: OrganizationProfileSection;
  onDeleted?: (organization: OrganizationDetails) => void;
  onLeft?: (organization: OrganizationDetails) => void;
};

const SECTION_KEYS: Record<OrganizationProfileSection, MessageKey> = {
  general: 'organization.profile.nav.general',
  members: 'organization.profile.nav.members',
  teams: 'organization.profile.nav.teams',
  invitations: 'organization.profile.nav.invitations',
  danger: 'organization.profile.nav.danger',
};

const TeamsSection = React.lazy(() => import('./organization/TeamsSection'));

export function OrganizationProfile({ organizationId, defaultSection = 'general', onDeleted, onLeft }: OrganizationProfileProps = {}) {
  const t = useT();
  const toServerError = useServerError();
  const { config, isLoading: configLoading } = usePublicConfig();
  const { user, isLoaded, isSignedIn } = useUser();
  const session = useSession();
  const api = useAuthClient().organization;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const activeOrganizationId = session.data?.session.activeOrganizationId ?? null;
  const requestedId = organizationId ?? activeOrganizationId;
  const enabled = config?.organizations === true && isSignedIn;
  const [organization, setOrganization] = React.useState<OrganizationDetails | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [wasRemoved, setWasRemoved] = React.useState(false);
  const [section, setSection] = React.useState<OrganizationProfileSection>(defaultSection);
  const requestRef = React.useRef(0);

  const load = React.useCallback(async () => {
    const token = ++requestRef.current;
    if (!enabled || !requestedId) {
      setOrganization(null);
      setError(null);
      return;
    }
    try {
      const result = await apiRef.current.get({ organizationId: requestedId });
      if (token !== requestRef.current) return;
      if (result.error) {
        setError(toServerError(result.error, t('organization.profile.loadError')));
        return;
      }
      setError(null);
      setOrganization(result.data ?? null);
    } catch {
      if (token === requestRef.current) setError(t('organization.profile.loadError'));
    }
  }, [enabled, requestedId, t, toServerError]);

  React.useEffect(() => {
    setOrganization(null);
    setError(null);
    setWasRemoved(false);
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  if (configLoading || !isLoaded) return <div className="ba-skeleton" aria-label={t('organization.loading')} />;
  if (config?.organizations !== true) return null;
  if (!isSignedIn || !user) return <p className="ba-muted">{t('organization.signedOut')}</p>;
  if (wasRemoved) return <p className="ba-muted">{t('organization.profile.noActive')}</p>;
  if (!requestedId) return <p className="ba-muted">{t('organization.profile.noActive')}</p>;
  if (error) {
    return (
      <div className="ba-inline-error">
        <FormError>{error}</FormError>
        <button className="ba-link-button" type="button" onClick={() => void load()}>{t('organization.retry')}</button>
      </div>
    );
  }
  if (!organization) return <div className="ba-skeleton" aria-label={t('organization.loading')} />;

  const membership = organization.members.find((member) => member.userId === user.id);
  if (!membership) return <p className="ba-muted">{t('organization.profile.notMember')}</p>;
  const canManage = canManageOrganization(membership);
  const visibleSections: OrganizationProfileSection[] = canManage
    ? ['general', 'members', 'teams', 'invitations', 'danger']
    : ['general', 'members', 'teams', 'danger'];
  const activeSection = visibleSections.includes(section) ? section : 'general';

  const handleRemoval = (callback: OrganizationProfileProps['onDeleted'] | OrganizationProfileProps['onLeft']) => (removedOrganization: OrganizationDetails) => {
    setWasRemoved(true);
    setOrganization(null);
    callback?.(removedOrganization);
  };

  return (
    <article className="ba-organization-profile">
      <header className="ba-organization-profile-heading">
        <span className="ba-organization-avatar ba-organization-avatar-large" aria-hidden="true">{organization.name.trim().charAt(0).toUpperCase() || '?'}</span>
        <span><h2 className="ba-title">{organization.name}</h2><p className="ba-muted">{organization.slug}</p></span>
      </header>
      <div className="ba-organization-profile-layout">
        <nav className="ba-organization-profile-nav" aria-label={t('organization.profile.nav.label')}>
          {visibleSections.map((item) => (
            <button
              key={item}
              className="ba-profile-nav-item"
              type="button"
              aria-current={activeSection === item ? 'page' : undefined}
              onClick={() => setSection(item)}
            >
              {t(SECTION_KEYS[item])}
            </button>
          ))}
        </nav>
        <div className="ba-organization-profile-content">
          {activeSection === 'general' && <GeneralSection organization={organization} canManage={canManage} onChanged={load} />}
          {activeSection === 'members' && <MembersSection organization={organization} userId={user.id} canManage={canManage} onChanged={load} />}
          {activeSection === 'teams' && (
            <React.Suspense fallback={null}>
              <TeamsSection organization={organization} canManage={canManage} />
            </React.Suspense>
          )}
          {activeSection === 'invitations' && <InvitationsSection organization={organization} onChanged={load} />}
          {activeSection === 'danger' && (
            <DangerSection
              organization={organization}
              membership={membership}
              onDeleted={handleRemoval(onDeleted)}
              onLeft={handleRemoval(onLeft)}
            />
          )}
        </div>
      </div>
    </article>
  );
}

export type { OrganizationProfileSection } from './organization/model';
