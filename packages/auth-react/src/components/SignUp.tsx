'use client';
import { StepCard } from './StepCard';
import { useAuthCardLock } from './AuthCardLock';
import { useSubmitAction } from './use-submit-action';
import { useStepFocus } from './use-step-focus';
import { AuthField } from './AuthField';
import { useSlot } from '../elements';
import * as React from 'react';
import { useHandoffCompletion } from './use-handoff-completion';
import { createIdempotencyKey, readInvitationClaim } from '@authowl/core';
import { usePublicConfig, useSignUp } from '../hooks';
import { useLocale, useT } from '../i18n';
import { SocialButtons } from './SocialButtons';
import { VerificationPending } from './VerificationPending';
import { LegalConsentCheckbox } from './LegalConsentCheckbox';
import { PasswordlessSignUp } from './PasswordlessSignUp';
import { PasskeyOffer } from './PasskeyOffer';
import { Busy } from './Spinner';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';
import { Waitlist } from './Waitlist';
import { resolveProjectCapabilities } from '../project-capabilities';
import { InvitationBanner } from './InvitationBanner';
import { PublicConfigError } from './PublicConfigError';
import { PrivacySignUpEvidence } from './PrivacySignUpEvidence';
import { MfaEnrollmentStep, useConfirmedMfaPending } from './mfa-enrollment-step';

export type SignUpProps = {
  /** Mailbox proof supplied by AcceptApplicationInvitation. */
  applicationInvitationProof?: string;
  initialEmail?: string;
  redirectTo?: string;
  onSignedUp?: () => void;
  /**
   * URL of your verify page (where <VerifyEmail/> is mounted). When the project
   * requires email verification, the emailed link redirects here after confirming.
   * Passed as the sign-up callbackURL; its origin must be an allowed origin.
   */
  verifyEmailUrl?: string;
  /**
   * Force the "Secured by AuthOwl" badge on even when the plan would hide it
   * (paid/comped projects). Free projects always show it regardless.
   */
  showBadge?: boolean;
  /** Called after an enrollment request is accepted while waitlist mode is active. */
  onWaitlisted?: () => void;
  /** Hide the project header when the host surface renders the same branding itself. */
  showBranding?: boolean;
};

export function SignUp({
  applicationInvitationProof,
  initialEmail = '',
  redirectTo,
  onSignedUp,
  verifyEmailUrl,
  showBadge,
  onWaitlisted,
  showBranding = true,
}: SignUpProps = {}) {
  const slot = useSlot();
  const t = useT();
  const locale = useLocale();
  const { signUp } = useSignUp();
  const { config, isLoading, isError } = usePublicConfig();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState(initialEmail);
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [username, setUsername] = React.useState('');
  const { pending: submitting, error, setError, run } = useSubmitAction();
  useHandoffCompletion(redirectTo, onSignedUp, () => setError(t('signUp.error.failed')));
  const mfaEnrollment = useConfirmedMfaPending('clear');
  const lock = useAuthCardLock(submitting);
  const { locked } = lock;
  // Legal consent: when the project requires it, the account can't be created
  // until this is ticked. It gates BOTH the password submit and the social
  // buttons (a social sign-in also creates the account), and the accepted
  // version rides along in the sign-up body so the server records + enforces it.
  const [accepted, setAccepted] = React.useState(false);
  const [grantedPurposeCodes, setGrantedPurposeCodes] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [privacyCorrelationId] = React.useState(createIdempotencyKey);
  const legal = config?.legal;
  const consentRequired = Boolean(legal?.required);
  const consentBlocked = consentRequired && !accepted;
  const capabilities = resolveProjectCapabilities(config);
  const passwordMinLength = capabilities.passwordMinLength;
  const passwordMaxLength = capabilities.passwordMaxLength;
  const passkeysEnabled = capabilities.passkeyAdd;
  // Set to the signed-up email once the server withholds a session pending
  // verification (EmailSignUpData.sessionCreated === false), which flips the UI
  // to the "check your email" panel instead of redirecting.
  const [pendingEmail, setPendingEmail] = React.useState<string | null>(null);
  const [completeWithPasskey, setCompleteWithPasskey] = React.useState(false);

  const step = isLoading ? 'loading' : isError ? 'error' : mfaEnrollment === 'confirming' ? 'mfa-confirming'
    : mfaEnrollment === 'pending' ? 'mfa-enrolment' : config?.signUp?.mode === 'waitlist' ? 'waitlist'
    : pendingEmail ? 'verify-pending' : completeWithPasskey ? 'passkey-offer' : 'form';
  const { stepRef } = useStepFocus(step, !isLoading && !isError && mfaEnrollment !== 'confirming');

  const updateField = (setValue: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    setError(null);
  };

  function finishSignUp() {
    onSignedUp?.();
    if (redirectTo) window.location.assign(redirectTo);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked) return;
    setError(null);
    if (consentBlocked) {
      setError(t('signUp.error.consentRequired'));
      return;
    }
    if (password.length < passwordMinLength) {
      setError(t('common.error.passwordTooShort', { min: passwordMinLength }));
      return;
    }
    void run(async () => {
      const privacyEvidence = config?.privacy && config.privacy.notices.length > 0
        ? (await import('@authowl/core/privacy')).buildPrivacySignUpEvidence(
            config.privacy,
            locale,
            grantedPurposeCodes,
            privacyCorrelationId,
          )
        : undefined;
      return authChallenge.run(AUTH_CHALLENGE_ACTIONS.signUp, (options) =>
        signUp(
          {
            email,
            invitationProof: applicationInvitationProof ? undefined : readInvitationClaim()?.proof,
            applicationInvitationProof,
            password,
            name: capabilities.firstLastName
              ? [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
              : capabilities.legacyNameField
                ? name
                : '',
            ...(capabilities.collectUsername ? { username } : {}),
            ...(capabilities.firstLastName
              ? {
                  ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
                  ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
                }
              : {}),
            callbackURL: verifyEmailUrl,
            consentVersion: legal?.required ? legal.version : undefined,
            ...(privacyEvidence ? { privacyEvidence } : {}),
          },
          options,
        ),
      );
    }, {
      failure: t('signUp.error.failed'),
      onSuccess: (res) => {
        if (res.data && !res.data.sessionCreated) {
          setPendingEmail(email);
          return;
        }
        if (passkeysEnabled) setCompleteWithPasskey(true);
        else finishSignUp();
      },
    });
  }

  function renderStep() {
    if (isLoading) {
      return (
        <>
          <div className={slot('ba-skeleton')} />
          <div className={slot('ba-skeleton')} />
        </>
      );
    }

    if (isError) {
      return (
        <PublicConfigError showBadge={showBadge} showBranding={showBranding} />
      );
    }

    if (mfaEnrollment !== 'clear') {
      return mfaEnrollment === 'pending' ? <MfaEnrollmentStep /> : <div className={slot('ba-skeleton')} />;
    }

    if (config?.signUp?.mode === 'waitlist') {
      return (
        <Waitlist onJoined={onWaitlisted} showBadge={showBadge} showBranding={showBranding} />
      );
    }

    if (pendingEmail) {
      return (
        <VerificationPending
          email={pendingEmail}
          callbackURL={verifyEmailUrl}
          method={capabilities.emailVerificationMethod}
        />
      );
    }

    // Zero-config rendering: password registration only if the project enables it;
    // social always creates an account on first use. Fall back to password when
    // config is unavailable.
    const methods = config?.enabledMethods ?? ['password'];
    const publicSignupAllowed = config?.signUp?.mode !== 'restricted' || Boolean(applicationInvitationProof);
    const exactPrivacyEvidenceRequired = (config?.privacy?.notices.length ?? 0) > 0;
    // Under required legal acceptance or exact privacy-notice delivery, drop
    // social from the sign-up surface: a keyless OAuth callback cannot carry the
    // accepted contract or the exact notice versions, so the server blocks it.
    // Password sign-up captures consent; social stays a sign-IN method for existing
    // users. (A consent-required, social-only project therefore has no sign-up path,
    // surfaced as the "no methods" state below.)
    const social =
      applicationInvitationProof || consentRequired || exactPrivacyEvidenceRequired || !publicSignupAllowed
        ? []
        : (config?.socialProviders ?? []);
    const showPassword =
      publicSignupAllowed
      && capabilities.passwordSignIn
      && capabilities.emailSignUp
      && capabilities.passwordSignUp;
    const showPasswordless =
      !applicationInvitationProof
      && publicSignupAllowed
      && capabilities.emailOtpSignIn
      && capabilities.emailSignUp
      && !consentRequired
      && !exactPrivacyEvidenceRequired
      && !capabilities.mfaRequired;
    const renderable = showPassword || showPasswordless || social.length > 0;

    if (completeWithPasskey) {
      return (
        <PasskeyOffer variant="sign-up" onComplete={finishSignUp} />
      );
    }

    return (
      <>
        <InvitationBanner />
        <SocialButtons providers={social} signUp />
        {showPassword && social.length > 0 && (
          <div className={slot('ba-divider')}>{t('common.orDivider')}</div>
        )}
        {showPassword && (
          <form method="post" onSubmit={onSubmit} className={slot('ba-fields')}>
            {capabilities.legacyNameField && (
              <AuthField
                label={t('signUp.nameLabel')}
                value={name}
                onChange={updateField(setName)}
                autoComplete="name"
                required
              />
            )}
            {capabilities.firstLastName && (
              <div className={slot('ba-name-row')}>
                <AuthField
                  label={t('signUp.firstNameLabel')}
                  value={firstName}
                  onChange={updateField(setFirstName)}
                  autoComplete="given-name"
                />
                <AuthField
                  label={t('signUp.lastNameLabel')}
                  value={lastName}
                  onChange={updateField(setLastName)}
                  autoComplete="family-name"
                />
              </div>
            )}
            {capabilities.collectUsername && (
              <AuthField
                label={t('common.usernameLabel')}
                value={username}
                onChange={updateField(setUsername)}
                autoComplete="username"
                required
              />
            )}
            <AuthField
              label={t('common.emailLabel')}
              type="email"
              value={email}
              onChange={updateField(setEmail)}
              autoComplete="email"
              required
            />
            <AuthField
              label={t('common.passwordLabel')}
              type="password"
              value={password}
              onChange={updateField(setPassword)}
              autoComplete="new-password"
              minLength={passwordMinLength}
              maxLength={passwordMaxLength}
              required
            />
            {authChallenge.control}
            {config?.privacy && (
              <PrivacySignUpEvidence
                privacy={config.privacy}
                locale={locale}
                grantedPurposeCodes={grantedPurposeCodes}
                onPurposeChange={(purposeCode, granted) => {
                  setGrantedPurposeCodes((current) => {
                    const next = new Set(current);
                    if (granted) next.add(purposeCode);
                    else next.delete(purposeCode);
                    return next;
                  });
                }}
              />
            )}
            {legal && (
              <LegalConsentCheckbox
                legal={legal}
                accepted={accepted}
                onAcceptedChange={setAccepted}
                testId="signup-consent"
              />
            )}
            <FormError>{error}</FormError>
            <button
              className={slot('ba-button')}
              type="submit"
              disabled={locked || consentBlocked || authChallenge.configPending}
              aria-busy={submitting || undefined}
            >
              <Busy busy={submitting} label={t('signUp.submitPending')}>{t('signUp.submit')}</Busy>
            </button>
          </form>
        )}
        {showPasswordless && (showPassword || social.length > 0) && (
          <div className={slot('ba-divider')}>{t('common.orDivider')}</div>
        )}
        {showPasswordless && (
          <PasswordlessSignUp
            onAuthenticated={() => {
              if (passkeysEnabled) setCompleteWithPasskey(true);
              else finishSignUp();
            }}
          />
        )}
        {!renderable && (
          <p className={slot('ba-muted')}>
            {publicSignupAllowed && methods.length > 0
              ? t('signUp.empty.unsupported')
              : t('signUp.empty.none')}
          </p>
        )}
      </>
    );
  }

  return (
    <StepCard lock={lock} key={step} step={step} kind="signUp" stepRef={stepRef} showBadge={showBadge} showBranding={showBranding}>
      {renderStep()}
    </StepCard>
  );
}
