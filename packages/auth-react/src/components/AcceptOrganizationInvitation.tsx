'use client';
import * as React from 'react';
import { useInvitationRecipientHint, useOrganizationInvitation, useSignOut, useUser, usePublicConfig } from '../hooks';
import { useServerError, useT } from '../i18n';
import { SignIn } from './SignIn';
import { SignUp } from './SignUp';
import { FormError } from './FormError';
import { VerificationPending } from './VerificationPending';
import { MFARequiredGate } from './MFARequiredGate';

export type AcceptOrganizationInvitationProps = {
  onJoined?: () => void;
  verifyEmailUrl?: string;
  resetPasswordUrl?: string;
};

/** Mount with invitationPrompt={false} to keep authentication and joining on one page. */
export function AcceptOrganizationInvitation(props: AcceptOrganizationInvitationProps) {
  return <MFARequiredGate><InvitationJourney {...props} /></MFARequiredGate>;
}

function InvitationJourney({ onJoined, verifyEmailUrl, resetPasswordUrl }: AcceptOrganizationInvitationProps) {
  const t = useT();
  const toMessage = useServerError();
  const user = useUser();
  const { config } = usePublicConfig();
  const hint = useInvitationRecipientHint();
  const { invitation, status, error, accept, retry } = useOrganizationInvitation();
  const { signOut } = useSignOut();
  const [mode, setMode] = React.useState<'signin' | 'signup' | null>(null);
  const [signupInProgress, setSignupInProgress] = React.useState(false);
  const signingUp = mode === 'signup' || (mode === null && hint.recipientHint === 'new_user');
  React.useEffect(() => {
    if (user.isLoaded && !user.isSignedIn) setSignupInProgress(signingUp);
  }, [user.isLoaded, user.isSignedIn, signingUp]);
  const [joined, setJoined] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  if (!user.isLoaded || !hint.isLoaded || (status === 'loading' && !signupInProgress)) {
    return <div className="ba-form" aria-busy="true"><p className="ba-muted">{t('common.loading')}</p></div>;
  }
  if (joined) return <p role="status" className="ba-muted">{t('organization.invitationPage.joined')}</p>;
  if (!user.isSignedIn || signupInProgress) {
    return <div className="ba-fields">
      {signingUp ? <SignUp onSignedUp={() => setSignupInProgress(false)} verifyEmailUrl={verifyEmailUrl} showBranding={false} />
        : <SignIn resetPasswordUrl={resetPasswordUrl} showBranding={false} />}
      <button type="button" className="ba-link-button" onClick={() => { setSignupInProgress(false); setMode(signingUp ? 'signin' : 'signup'); }}>
        {t(signingUp ? 'organization.invitationPage.signin' : 'organization.invitationPage.signup')}
      </button>
    </div>;
  }
  const errorKey = status === 'wrong_account' ? 'organization.invitationPrompt.error.wrongAccount'
    : status === 'verify_email' ? 'organization.invitationPrompt.error.verifyEmail'
    : status === 'gone' || status === 'idle' ? 'organization.invitationPrompt.error.gone'
    : status === 'error' || failed ? 'organization.invitationPrompt.error.generic' : null;
  return <section className="ba-fields" data-testid="organization-invitation-page">
    <h1 className="ba-title">{t('organization.invitationPrompt.title')}</h1>
    {invitation && <p className="ba-subtitle">{t('organization.invitationPrompt.body', { organization: invitation.organizationName })}</p>}
    <FormError>{errorKey && (status === 'error' ? toMessage(error, t(errorKey)) : t(errorKey))}</FormError>
    {invitation && (status === 'ready' || status === 'joining' || status === 'error') &&
      <button type="button" className="ba-button" disabled={status === 'joining'} onClick={async () => {
        setFailed(false);
        try {
          if (await accept()) { setJoined(true); onJoined?.(); }
        } catch { setFailed(true); }
      }}>{t(status === 'joining' ? 'organization.invitationPrompt.joining' : 'organization.invitationPrompt.accept')}</button>}
    {status === 'error' && !invitation && <button className="ba-button" type="button" onClick={retry}>{t('organization.retry')}</button>}
    {status === 'verify_email' && user.user?.email && <><VerificationPending email={user.user.email} callbackURL={verifyEmailUrl} method={config?.emailVerification?.method} /><button type="button" className="ba-link-button" onClick={retry}>{t('organization.retry')}</button></>}
    {status === 'wrong_account' && <button type="button" className="ba-button" onClick={() => void signOut()}>{t('organization.invitationPrompt.signOut')}</button>}
  </section>;
}
