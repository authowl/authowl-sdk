'use client';
import * as React from 'react';
import { useOrganizationInvitation, useSignOut } from '../hooks';
import { useT } from '../i18n';
import { ModalSurface } from './ModalSurface';

/**
 * The one screen that turns an emailed organization invitation into a
 * membership.
 *
 * It is CONFIRMED rather than automatic, and the reason is not taste: accepting
 * can fail for reasons the user has to see and can act on - the organization is
 * at its member cap, the role no longer fits the claim budget, the invitation
 * expired, the session belongs to a different address. An automatic redeem has
 * nowhere to render any of that, which would recreate the very defect this fixes
 * (a flow that reports success and produces no membership) one layer up.
 *
 * `AuthOwlProvider` renders this, so an operator who mounts our components
 * anywhere gets a working invitation flow without adding a route. Headless
 * consumers pass `invitationPrompt={false}` and drive
 * {@link useOrganizationInvitation} themselves - they never import our
 * stylesheet, so the default modal would render unstyled for them.
 */
export function InvitationPrompt() {
  const t = useT();
  const { invitation, status, accept, dismiss } = useOrganizationInvitation();
  const { signOut } = useSignOut();
  const headingId = React.useId();

  if (status === 'idle' || status === 'loading') return null;

  const message = (() => {
    switch (status) {
      case 'wrong_account':
        return t('organization.invitationPrompt.error.wrongAccount');
      case 'verify_email':
        return t('organization.invitationPrompt.error.verifyEmail');
      case 'gone':
        return t('organization.invitationPrompt.error.gone');
      case 'error':
        return t('organization.invitationPrompt.error.generic');
      default:
        return null;
    }
  })();

  const joining = status === 'joining';
  // A dead invitation and a wrong account both have nothing left to accept, so
  // the only honest control is the one that closes the notice.
  const canAccept = status === 'ready' || status === 'error' || joining;

  return (
    <ModalSurface
      overlayClassName="ba-invitation-overlay"
      panelClassName="ba-invitation-panel"
      labelledBy={headingId}
      testId="authowl-invitation-prompt"
      onClose={dismiss}
    >
      <h2 id={headingId} className="ba-title">
        {t('organization.invitationPrompt.title')}
      </h2>
      {invitation ? (
        <p className="ba-subtitle">
          {t('organization.invitationPrompt.body', { organization: invitation.organizationName })}
        </p>
      ) : null}
      {message ? (
        <p className="ba-error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="ba-invitation-actions">
        {canAccept ? (
          <button
            type="button"
            className="ba-button"
            onClick={() => void accept()}
            disabled={joining}
          >
            {joining
              ? t('organization.invitationPrompt.joining')
              : t('organization.invitationPrompt.accept')}
          </button>
        ) : null}
        {status === 'wrong_account' ? (
          // Deliberately keeps the claim: the invitation is still live and still
          // theirs to accept from the right account, so it must survive the
          // sign-out and reappear after they sign back in.
          <button type="button" className="ba-button ba-button-secondary" onClick={() => void signOut()}>
            {t('organization.invitationPrompt.signOut')}
          </button>
        ) : null}
        <button type="button" className="ba-button ba-button-secondary" onClick={dismiss}>
          {t('organization.invitationPrompt.dismiss')}
        </button>
      </div>
    </ModalSurface>
  );
}
