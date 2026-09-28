'use client';
import * as React from 'react';
import { captureApplicationInvitationProof, clearApplicationInvitationProof, type ApplicationInvitationDetails } from '@authowl/core';
import { useAuthClient, usePublicConfig, useUser, useSignOut } from '../hooks';
import { useT, useServerError, richMessage, Bidi } from '../i18n';
import { SignUp } from './SignUp';
import { SignIn } from './SignIn';
import { MFARequiredGate } from './MFARequiredGate';
import { FormError } from './FormError';
import { VerificationPending } from './VerificationPending';

export type AcceptApplicationInvitationProps = {
  onJoined?: () => void;
  verifyEmailUrl?: string;
  resetPasswordUrl?: string;
};
/** Complete an emailed application invitation using ordinary authentication and MFA. */
export function AcceptApplicationInvitation(props: AcceptApplicationInvitationProps) {
  return <MFARequiredGate><ApplicationInvitationJourney {...props} /></MFARequiredGate>;
}
function ApplicationInvitationJourney({ onJoined, verifyEmailUrl, resetPasswordUrl }: AcceptApplicationInvitationProps) {
  const client = useAuthClient();
  const { config, isError, retry } = usePublicConfig();
  const user = useUser();
  const { signOut } = useSignOut();
  const t = useT();
  const toMessage = useServerError();
  const [proof, setProof] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<ApplicationInvitationDetails | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'signup' | 'signin'>('signup');
  const [busy, setBusy] = React.useState(false);
  const [joined, setJoined] = React.useState(false);
  const environment = config?.environmentId;
  React.useEffect(() => {
    if (!environment) return;
    let active = true;
    const captured = captureApplicationInvitationProof(environment);
    setProof(captured);
    setLoaded(false);
    setError(null);
    if (!captured) { setLoaded(true); return; }
    void client.applicationInvitations.inspect(captured).then(result => {
      if (!active) return;
      setDetails(result.data ?? null);
      setError(result.error ? toMessage(result.error, t('applicationInvitation.unavailable')) : null);
      setLoaded(true);
    }).catch(() => { if (active) { setError(t('applicationInvitation.retryError')); setLoaded(true); } });
    return () => { active = false; };
  }, [client, environment, attempt, t, toMessage]);
  if (isError) return <div className="ba-fields"><FormError>{t('applicationInvitation.retryError')}</FormError><button type="button" className="ba-button" onClick={retry}>{t('organization.retry')}</button></div>;
  if (!loaded || !user.isLoaded) return <p aria-busy="true" className="ba-muted">{t('common.loading')}</p>;
  if (joined) return <p role="status">{t('applicationInvitation.success')}</p>;
  if (!proof || !details) return <div className="ba-fields"><FormError>{error ?? t('applicationInvitation.unavailable')}</FormError><button type="button" className="ba-button" onClick={() => setAttempt(n => n + 1)}>{t('organization.retry')}</button></div>;
  if (!user.isSignedIn) return <div className="ba-fields">
    <h1 className="ba-title">{t('applicationInvitation.title')}</h1>
    <p className="ba-subtitle" style={{ overflowWrap: 'anywhere' }}>{richMessage(t('applicationInvitation.recipient'), { email: <Bidi>{details.email}</Bidi> })}</p>
    {mode === 'signup' && details.status === 'pending'
      ? <SignUp applicationInvitationProof={proof} initialEmail={details.email} verifyEmailUrl={verifyEmailUrl} showBranding={false} />
      : <SignIn resetPasswordUrl={resetPasswordUrl} showBranding={false} />}
    {details.status === 'pending' && <button type="button" className="ba-link-button" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>{t(mode === 'signup' ? 'organization.invitationPage.signin' : 'organization.invitationPage.signup')}</button>}
  </div>;
  const wrongAccount = user.user?.email?.toLowerCase() !== details.email.toLowerCase();
  if (wrongAccount) return <div className="ba-fields"><FormError>{t('organization.invitationPrompt.error.wrongAccount')}</FormError><button className="ba-button" type="button" onClick={() => void signOut()}>{t('organization.invitationPrompt.signOut')}</button></div>;
  if (!user.user?.emailVerified) return <VerificationPending email={details.email} callbackURL={verifyEmailUrl} method={config?.emailVerification?.method} />;
  return <section className="ba-fields" data-testid="application-invitation-page">
    <h1 className="ba-title">{t('applicationInvitation.title')}</h1>
    <p className="ba-subtitle" style={{ overflowWrap: 'anywhere' }}>{richMessage(t('applicationInvitation.recipient'), { email: <Bidi>{details.email}</Bidi> })}</p>
    <FormError>{error}</FormError>
    <button type="button" className="ba-button" disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try {
        const result = await client.applicationInvitations.accept(proof);
        if (result.error) setError(toMessage(result.error, t('applicationInvitation.retryError')));
        else { clearApplicationInvitationProof(environment!); setJoined(true); onJoined?.(); }
      } catch { setError(t('applicationInvitation.retryError')); }
      finally { setBusy(false); }
    }}>{t(busy ? 'common.loading' : 'applicationInvitation.accept')}</button>
  </section>;
}
