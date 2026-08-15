'use client';
import * as React from 'react';
import type { OrganizationDetails, OrganizationMemberWithUser } from '@authowl/core';
import { useAuthClient } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { organizationRoles } from './model';
import { organizationRoleLabel } from './role-label';
import { useOrganizationRoles } from './use-organization-roles';
import { FormError } from '../FormError';

export function MembersSection({
  organization,
  userId,
  canManage,
  onChanged,
}: {
  organization: OrganizationDetails;
  userId: string;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const api = useAuthClient().organization;
  const { pending, error, run } = useSubmitAction();
  const { roles } = useOrganizationRoles(organization.id);

  const updateRole = (member: OrganizationMemberWithUser, role: string) => {
    const current = organizationRoles(member.role)[0] ?? member.role;
    if (current === role) return;
    if (!window.confirm(t('organization.profile.members.roleConfirm', { name: member.user.name, role: organizationRoleLabel(role, t) }))) return;
    void run(
      () => api.updateMemberRole({ organizationId: organization.id, memberId: member.id, role }),
      { failure: t('organization.profile.members.roleError'), onSuccess: onChanged },
    );
  };

  const remove = (member: OrganizationMemberWithUser) => {
    if (!window.confirm(t('organization.profile.members.removeConfirm', { name: member.user.name }))) return;
    void run(
      () => api.removeMember({ organizationId: organization.id, memberIdOrEmail: member.id }),
      { failure: t('organization.profile.members.removeError'), onSuccess: onChanged },
    );
  };

  return (
    <section className="ba-organization-section">
      <header className="ba-organization-section-header">
        <h3 className="ba-title">{t('organization.profile.members.title')}</h3>
        <p className="ba-muted">{t('organization.profile.members.description')}</p>
      </header>
      <FormError>{error}</FormError>
      <ul className="ba-organization-list">
        {organization.members.map((member) => {
          const primaryRole = organizationRoles(member.role)[0] ?? member.role;
          const isCurrent = member.userId === userId;
          return (
            <li key={member.id} className="ba-organization-member">
              <span className="ba-organization-avatar" aria-hidden="true">{member.user.name.trim().charAt(0).toUpperCase() || '?'}</span>
              <span className="ba-organization-member-copy">
                <strong>{member.user.name}{isCurrent ? ` ${t('organization.profile.members.you')}` : ''}</strong>
                <small><Bidi>{member.user.email}</Bidi></small>
              </span>
              {canManage && !isCurrent ? (
                <span className="ba-organization-member-actions">
                  <label className="ba-sr-only" htmlFor={`organization-role-${member.id}`}>{t('organization.profile.members.role')}</label>
                  <select
                    id={`organization-role-${member.id}`}
                    className="ba-input ba-organization-role"
                    value={primaryRole}
                    disabled={pending}
                    onChange={(event) => updateRole(member, event.target.value)}
                  >
                    {(roles.includes(primaryRole) ? roles : [primaryRole, ...roles]).map((role) => (
                      <option key={role} value={role}>{organizationRoleLabel(role, t)}</option>
                    ))}
                  </select>
                  <button className="ba-link-button ba-danger" type="button" disabled={pending} onClick={() => remove(member)}>
                    {t('organization.profile.members.remove')}
                  </button>
                </span>
              ) : (
                <span className="ba-organization-role-label">{organizationRoleLabel(primaryRole, t)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
