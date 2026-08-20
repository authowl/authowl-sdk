'use client';
import * as React from 'react';
import { readInvitationClaim } from '@authowl/core';
import { useT } from '../i18n';

/**
 * A one-line notice on the sign-in and sign-up forms when this browser is
 * carrying an organization invitation.
 *
 * It exists to defuse the trap that has no recovery: an invitee who signs UP
 * with a different address than the one invited can never accept, because the
 * engine binds acceptance to the recipient's email. The wording is deliberately
 * generic - the invitation's details are recipient-only, so before there is a
 * session we cannot name the organization without leaking who was invited.
 *
 * Read after mount, never during render: the claim lives in `localStorage`,
 * which does not exist on the server, and reading it during render would make
 * the markup disagree with itself at hydration.
 */
export function InvitationBanner() {
  const t = useT();
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    setPending(readInvitationClaim() !== null);
  }, []);

  if (!pending) return null;
  return (
    <p className="ba-muted" data-testid="authowl-invitation-banner">
      {t('organization.invitationBanner')}
    </p>
  );
}
