'use client';
import * as React from 'react';
import type { OrganizationUserInvitation } from '@authowl/core';
import { useAuthClient, useSession, useUser } from '../../hooks';
import { useServerError, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { FormError } from '../FormError';
import { organizationRoleLabel } from './role-label';

export function IncomingInvitations({ onChanged }: { onChanged: () => Promise<void> }) {
  const t = useT();
  const toServerError = useServerError();
  const { user, isLoaded, isSignedIn } = useUser();
  const session = useSession();
  const api = useAuthClient().organization;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const enabled = isSignedIn;
  const { pending, error, run } = useSubmitAction();
  const [invitations, setInvitations] = React.useState<OrganizationUserInvitation[] | null>(null);
  const [invitationError, setInvitationError] = React.useState<string | null>(null);
  const invitationRequestRef = React.useRef(0);
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

  const invitationAction = (invitation: OrganizationUserInvitation, action: 'accept' | 'reject') => {
    const onSuccess = async () => {
      await Promise.all([onChanged(), loadInvitations()]);
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

  return <>
    <FormError>{error}</FormError>
        <section className="ba-organization-user-invitations">
          <header className="ba-organization-section-header"><h3 className="ba-title">{t('organization.list.invitationsTitle')}</h3><p className="ba-muted">{t('organization.list.invitationsDescription')}</p></header>
          {invitationError && <div className="ba-inline-error"><FormError>{invitationError}</FormError><button className="ba-link-button" type="button" onClick={() => void loadInvitations()}>{t('organization.retry')}</button></div>}
          {invitations?.length ? (
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
          ) : invitationError ? null : invitations === null ? <div className="ba-skeleton" /> : <p className="ba-muted">{t('organization.list.noInvitations')}</p>}
        </section>
  </>;
}
