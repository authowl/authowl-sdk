'use client';
import * as React from 'react';
import type { OrganizationDetails, OrganizationInvitation } from '@authowl/core';
import { useAuthClient, usePublicConfig } from '../../hooks';
import { Bidi, useServerError, useT } from '../../i18n';
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
  const { config } = usePublicConfig();
  const toMessage = useServerError();
  // Older servers support a single recipient. New servers publish their batch bound.
  const maxBatch = config?.organizationInvitations?.maxBatchSize ?? 1;
  const [outcomes, setOutcomes] = React.useState<Array<{ email: string; error: string | null }>>([]);
  const { pending, error, setError, run } = useSubmitAction();
  const { roles } = useOrganizationRoles(organization.id);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('member');
  const invitations = organization.invitations.filter((invitation) => invitation.status === 'pending');

  const invite = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const recipients = [...new Set(email.split(/[\s,;]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
    if (recipients.length > maxBatch || recipients.some((entry) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry))) {
      setError(t('organization.profile.invitations.invalidBatch', { count: maxBatch }));
      return;
    }
    void run(async () => {
      const results = [];
      for (const recipient of recipients) {
        let failure: string | null = null;
        try {
          const result = await api.inviteMember({ organizationId: organization.id, email: recipient, role });
          if (result.error) failure = toMessage(result.error, t('organization.profile.invitations.inviteError'));
        } catch { failure = t('organization.profile.invitations.inviteError'); }
        results.push({ email: recipient, error: failure });
      }
      setOutcomes(results);
      setEmail(results.filter((result) => result.error).map((result) => result.email).join('\n'));
      return { data: results, error: null };
    }, { failure: t('organization.profile.invitations.inviteError'), onSuccess: onChanged });
  };

  const resend = (invitation: OrganizationInvitation) => {
    void run(() => api.inviteMember({ organizationId: organization.id, email: invitation.email, role: invitation.role, resend: true }), {
      failure: t('organization.profile.invitations.inviteError'),
      onSuccess: async () => { setOutcomes([{ email: invitation.email, error: null }]); await onChanged(); },
    });
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
          {t('organization.profile.invitations.emails')}
          <textarea className="ba-input" dir="ltr" rows={3} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} required />
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
      <p className="ba-muted">{t('organization.profile.invitations.allowance', { count: maxBatch })}</p>
      <FormError>{error}</FormError>
      {outcomes.length > 0 && (
        <ul className="ba-organization-list ba-organization-invite-results" role="status">
          {outcomes.map((outcome) => (
            <li className="ba-organization-invitation" key={outcome.email}>
              <span><strong><Bidi>{outcome.email}</Bidi></strong><small>{outcome.error ?? t('organization.profile.invitations.sent')}</small></span>
            </li>
          ))}
        </ul>
      )}
      {invitations.length === 0 ? (
        <p className="ba-muted">{t('organization.profile.invitations.empty')}</p>
      ) : (
        <ul className="ba-organization-list">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="ba-organization-invitation">
              <span><strong><Bidi>{invitation.email}</Bidi></strong><small>{organizationRoleLabel(invitation.role, t)}</small></span>
              <span className="ba-organization-card-actions">
              <button className="ba-link-button" type="button" disabled={pending} onClick={() => resend(invitation)}>{t('organization.profile.invitations.resend')}</button>
              <button className="ba-link-button ba-danger" type="button" disabled={pending} onClick={() => cancel(invitation)}>
                {t('organization.profile.invitations.cancel')}
              </button></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
