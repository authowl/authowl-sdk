'use client';
import * as React from 'react';
import type { OrganizationDetails, OrganizationInvitation } from '@authowl/core';
import { useAuthClient } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { organizationRoleLabel } from './role-label';
import { useOrganizationRoles } from './use-organization-roles';
import { FormError } from '../FormError';

export function InvitationsSection({
  organization,
  onChanged,
}: {
  organization: OrganizationDetails;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const api = useAuthClient().organization;
  const { pending, error, run } = useSubmitAction();
  const { roles } = useOrganizationRoles(organization.id);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('member');
  const invitations = organization.invitations.filter((invitation) => invitation.status === 'pending');

  const invite = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(
      () => api.inviteMember({ organizationId: organization.id, email: email.trim(), role }),
      {
        failure: t('organization.profile.invitations.inviteError'),
        onSuccess: async () => {
          setEmail('');
          await onChanged();
        },
      },
    );
  };

  const cancel = (invitation: OrganizationInvitation) => {
    if (!window.confirm(t('organization.profile.invitations.cancelConfirm', { email: invitation.email }))) return;
    void run(
      () => api.cancelInvitation({ invitationId: invitation.id }),
      { failure: t('organization.profile.invitations.cancelError'), onSuccess: onChanged },
    );
  };

  return (
    <section className="ba-organization-section">
      <header className="ba-organization-section-header">
        <h3 className="ba-title">{t('organization.profile.invitations.title')}</h3>
        <p className="ba-muted">{t('organization.profile.invitations.description')}</p>
      </header>
      <form method="post" className="ba-organization-invite-form" onSubmit={invite}>
        <label className="ba-label">
          {t('organization.profile.invitations.email')}
          <input className="ba-input" type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="ba-label">
          {t('organization.profile.members.role')}
          <select className="ba-input" value={role} onChange={(event) => setRole(event.target.value)}>
            {roles.map((option) => (
              <option key={option} value={option}>{organizationRoleLabel(option, t)}</option>
            ))}
          </select>
        </label>
        <button
          className="ba-button"
          type="submit"
          disabled={pending || !email.trim()}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('common.working')}>{t('organization.profile.invitations.invite')}</Busy>
        </button>
      </form>
      <FormError>{error}</FormError>
      {invitations.length === 0 ? (
        <p className="ba-muted">{t('organization.profile.invitations.empty')}</p>
      ) : (
        <ul className="ba-organization-list">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="ba-organization-invitation">
              <span><strong><Bidi>{invitation.email}</Bidi></strong><small>{organizationRoleLabel(invitation.role, t)}</small></span>
              <button className="ba-link-button ba-danger" type="button" disabled={pending} onClick={() => cancel(invitation)}>
                {t('organization.profile.invitations.cancel')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
