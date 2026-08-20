'use client';
import * as React from 'react';
import type { OrganizationDetails, OrganizationTeam, OrganizationTeamMember } from '@authowl/core';
import { useAuthClient } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { FormError } from '../FormError';
import { useSubmitAction } from '../use-submit-action';
import { useTeamMembersResource } from './use-team-resources';

export function TeamMembersPanel({
  organization,
  team,
  canManage,
}: {
  organization: OrganizationDetails;
  team: OrganizationTeam;
  canManage: boolean;
}) {
  const t = useT();
  const api = useAuthClient().organization;
  const { pending, error: actionError, run } = useSubmitAction();
  const [userId, setUserId] = React.useState('');
  const { members, error, reload } = useTeamMembersResource(team.id);
  const assignedUserIds = new Set(members?.map((member) => member.userId));
  const availableMembers = organization.members.filter((member) => !assignedUserIds.has(member.userId));
  const addableUserId = availableMembers.some((member) => member.userId === userId)
    ? userId
    : availableMembers[0]?.userId ?? '';

  const addMember = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addableUserId) return;
    void run(
      () => api.addTeamMember({
        teamId: team.id,
        userId: addableUserId,
        organizationId: organization.id,
      }),
      {
        failure: t('organization.profile.general.error'),
        onSuccess: async () => {
          setUserId('');
          await reload();
        },
      },
    );
  };

  const removeMember = (member: OrganizationTeamMember) => {
    const organizationMember = organization.members.find((entry) => entry.userId === member.userId);
    const displayName = organizationMember?.user.name || member.userId;
    if (!window.confirm(t('organization.profile.teams.removeMemberConfirm', { name: displayName }))) return;
    void run(
      () => api.removeTeamMember({
        teamId: team.id,
        userId: member.userId,
        organizationId: organization.id,
      }),
      {
        failure: t('organization.profile.general.error'),
        onSuccess: reload,
      },
    );
  };

  return (
    <div className="ba-organization-user-invitations">
      <h4>{t('organization.profile.teams.manageMembers')}</h4>
      {canManage && availableMembers.length > 0 && members !== null && !error && (
        <form method="post" className="ba-organization-invite-form" onSubmit={addMember}>
          <label className="ba-label">
            {t('organization.profile.teams.addMember')}
            <select className="ba-input" value={addableUserId} onChange={(event) => setUserId(event.target.value)}>
              {availableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>{member.user.name || member.user.email || member.userId}</option>
              ))}
            </select>
          </label>
          <button className="ba-button" type="submit" disabled={pending || !addableUserId}>{t('organization.profile.teams.addMember')}</button>
        </form>
      )}
      <FormError>{actionError}</FormError>
      {error ? (
        <div className="ba-inline-error">
          <FormError>{error}</FormError>
          <button className="ba-link-button" type="button" onClick={() => void reload()}>{t('organization.retry')}</button>
        </div>
      ) : members === null ? (
        <div className="ba-skeleton" aria-label={t('common.loading')} />
      ) : members.length === 0 ? (
        <p className="ba-muted">{t('organization.profile.teams.membersEmpty')}</p>
      ) : (
        <ul className="ba-organization-list">
          {members.map((member) => {
            const organizationMember = organization.members.find((entry) => entry.userId === member.userId);
            const displayName = organizationMember?.user.name || member.userId;
            return (
              <li key={member.id} className="ba-organization-member">
                <span className="ba-organization-member-copy">
                  <strong>{displayName}</strong>
                  {organizationMember?.user.email && <small><Bidi>{organizationMember.user.email}</Bidi></small>}
                </span>
                {canManage && (
                  <button className="ba-link-button ba-danger" type="button" disabled={pending} onClick={() => removeMember(member)}>
                    {t('organization.profile.teams.removeMember')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
