'use client';
import * as React from 'react';
import type { OrganizationDetails, OrganizationMember } from '@authowl/core';
import { useAuthClient, useSession } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { hasOrganizationRole } from './model';
import { FormError } from '../FormError';

export function DangerSection({
  organization,
  membership,
  onDeleted,
  onLeft,
}: {
  organization: OrganizationDetails;
  membership: OrganizationMember;
  onDeleted?: (organization: OrganizationDetails) => void;
  onLeft?: (organization: OrganizationDetails) => void;
}) {
  const t = useT();
  const api = useAuthClient().organization;
  const session = useSession();
  const { pending, error, run } = useSubmitAction();
  const [confirmation, setConfirmation] = React.useState('');
  const isOwner = hasOrganizationRole(membership, 'owner');
  const confirmed = confirmation.trim().toLowerCase() === organization.slug.toLowerCase();

  const leave = () => {
    if (!window.confirm(t('organization.profile.danger.leaveConfirm', { name: organization.name }))) return;
    void run(
      () => api.leave({ organizationId: organization.id }),
      {
        failure: t('organization.profile.danger.leaveError'),
        onSuccess: async () => {
          await session.refetch({ query: { disableCookieCache: true } });
          onLeft?.(organization);
        },
      },
    );
  };

  const remove = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed) return;
    void run(
      () => api.delete({ organizationId: organization.id }),
      {
        failure: t('organization.profile.danger.deleteError'),
        onSuccess: async () => {
          await session.refetch({ query: { disableCookieCache: true } });
          onDeleted?.(organization);
        },
      },
    );
  };

  return (
    <section className="ba-organization-section ba-organization-danger">
      <header className="ba-organization-section-header">
        <h3 className="ba-title">{t('organization.profile.danger.title')}</h3>
        <p className="ba-muted">{t('organization.profile.danger.description')}</p>
      </header>
      <div className="ba-organization-danger-action">
        <strong>{t('organization.profile.danger.leaveTitle')}</strong>
        <p className="ba-muted">{isOwner ? t('organization.profile.danger.ownerLeaveHint') : t('organization.profile.danger.leaveHint')}</p>
        <button className="ba-button ba-button-secondary" type="button" disabled={pending} onClick={leave}>
          {t('organization.profile.danger.leave')}
        </button>
      </div>
      {isOwner && (
        <form method="post" className="ba-organization-danger-action ba-organization-delete" onSubmit={remove}>
          <strong>{t('organization.profile.danger.deleteTitle')}</strong>
          <p className="ba-muted">{t('organization.profile.danger.deleteHint')}</p>
          <label className="ba-label">
            {t('organization.profile.danger.deleteConfirm')} <Bidi>{organization.slug}</Bidi>
            <input className="ba-input" dir="ltr" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required />
          </label>
          <button
            className="ba-button ba-danger-button"
            type="submit"
            disabled={pending || !confirmed}
            aria-busy={pending || undefined}
          >
            <Busy busy={pending} label={t('common.working')}>{t('organization.profile.danger.delete')}</Busy>
          </button>
        </form>
      )}
      <FormError>{error}</FormError>
    </section>
  );
}
