'use client';
import * as React from 'react';
import type { OrganizationDetails, OrganizationMember, OrganizationTeam } from '@authowl/core';
import { useAuthClient } from '../../hooks';
import { useT } from '../../i18n';
import { FormError } from '../FormError';
import { Busy } from '../Spinner';
import { useSubmitAction } from '../use-submit-action';
import { TeamMembersPanel } from './TeamMembersPanel';
import { teamManagementCapabilities } from './model';
import { useOrganizationRoles } from './use-organization-roles';
import { useTeamsResource } from './use-team-resources';

export default function TeamsSection({
  organization,
  membership,
}: {
  organization: OrganizationDetails;
  membership: OrganizationMember;
}) {
  const t = useT();
  const api = useAuthClient().organization;
  const { pending, error: actionError, run } = useSubmitAction();
  const { teams, error: teamsError, reload } = useTeamsResource(organization.id);
  const { dynamicRoles } = useOrganizationRoles(organization.id);
  const capabilities = teamManagementCapabilities(membership, dynamicRoles);
  const [name, setName] = React.useState('');
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState('');

  React.useEffect(() => {
    setSelectedTeamId(null);
    setEditingTeamId(null);
    setEditingName('');
  }, [organization.id]);

  const create = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(
      () => api.createTeam({ organizationId: organization.id, name: name.trim() }),
      {
        failure: t('organization.profile.general.error'),
        onSuccess: async () => {
          setName('');
          await reload();
        },
      },
    );
  };

  const beginRename = (team: OrganizationTeam) => {
    setEditingTeamId(team.id);
    setEditingName(team.name);
  };

  const rename = (event: React.FormEvent<HTMLFormElement>, team: OrganizationTeam) => {
    event.preventDefault();
    const nextName = editingName.trim();
    if (!nextName || nextName === team.name) return;
    void run(
      () => api.updateTeam({
        teamId: team.id,
        data: { name: nextName, organizationId: organization.id },
      }),
      {
        failure: t('organization.profile.general.error'),
        onSuccess: async () => {
          setEditingTeamId(null);
          setEditingName('');
          await reload();
        },
      },
    );
  };

  const remove = (team: OrganizationTeam) => {
    if (!window.confirm(t('organization.profile.teams.removeTeamConfirm', { name: team.name }))) return;
    void run(
      () => api.removeTeam({ teamId: team.id, organizationId: organization.id }),
      {
        failure: t('organization.profile.general.error'),
        onSuccess: async () => {
          if (selectedTeamId === team.id) setSelectedTeamId(null);
          if (editingTeamId === team.id) setEditingTeamId(null);
          await reload();
        },
      },
    );
  };

  const selectedTeam = teams?.find((team) => team.id === selectedTeamId);

  return (
    <section className="ba-organization-section">
      <header className="ba-organization-section-header">
        <h3 className="ba-title">{t('organization.profile.teams.title')}</h3>
        <p className="ba-muted">{t('organization.profile.teams.description')}</p>
      </header>
      {capabilities.createTeam ? (
        <form method="post" className="ba-organization-invite-form" onSubmit={create}>
          <label className="ba-label">
            {t('organization.profile.teams.create')}
            <input className="ba-input" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <button className="ba-button" type="submit" disabled={pending || !name.trim()} aria-busy={pending || undefined}>
            <Busy busy={pending} label={t('common.working')}>{t('organization.profile.teams.create')}</Busy>
          </button>
        </form>
      ) : null}
      <FormError>{actionError}</FormError>
      {teamsError && (
        <div className="ba-inline-error">
          <FormError>{teamsError}</FormError>
          <button className="ba-link-button" type="button" onClick={() => void reload()}>{t('organization.retry')}</button>
        </div>
      )}
      {teams?.length ? (
        <ul className="ba-organization-list">
          {teams.map((team) => (
            <li key={team.id} className="ba-organization-member">
              <span className="ba-organization-avatar" aria-hidden="true">{team.name.trim().charAt(0).toUpperCase() || '?'}</span>
              {editingTeamId === team.id ? (
                <form method="post" className="ba-organization-invite-form" onSubmit={(event) => rename(event, team)}>
                  <label className="ba-label">
                    {t('organization.profile.teams.rename')}
                    <input className="ba-input" value={editingName} onChange={(event) => setEditingName(event.target.value)} required autoFocus />
                  </label>
                  <button className="ba-button" type="submit" disabled={pending || !editingName.trim()}>{t('organization.profile.teams.rename')}</button>
                  <button className="ba-link-button" type="button" disabled={pending} onClick={() => setEditingTeamId(null)}>{t('organization.profile.teams.cancel')}</button>
                </form>
              ) : (
                <>
                  <span className="ba-organization-member-copy"><strong>{team.name}</strong></span>
                  <span className="ba-organization-member-actions">
                    <button className="ba-link-button" type="button" disabled={pending} aria-expanded={selectedTeamId === team.id} onClick={() => setSelectedTeamId(selectedTeamId === team.id ? null : team.id)}>
                      {t('organization.profile.teams.manageMembers')}
                    </button>
                    {capabilities.updateTeam && (
                      <button className="ba-link-button" type="button" disabled={pending} onClick={() => beginRename(team)}>{t('organization.profile.teams.rename')}</button>
                    )}
                    {capabilities.deleteTeam && (
                      <button className="ba-link-button ba-danger" type="button" disabled={pending} onClick={() => remove(team)}>{t('organization.profile.teams.removeTeam')}</button>
                    )}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : teamsError ? null : teams === null ? (
        <div className="ba-skeleton" aria-label={t('common.loading')} />
      ) : teams.length === 0 ? (
        <p className="ba-muted">{t('organization.profile.teams.empty')}</p>
      ) : null}
      {selectedTeam && (
        <TeamMembersPanel
          organization={organization}
          team={selectedTeam}
          canAdd={capabilities.addTeamMember}
          canRemove={capabilities.removeTeamMember}
        />
      )}
    </section>
  );
}
