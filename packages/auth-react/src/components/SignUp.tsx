'use client';
import * as React from 'react';
import { usePublicConfig, useSignUp } from '../hooks';
import { useT, useServerError } from '../i18n';
import { SocialButtons } from './SocialButtons';
import { AuthOwlBadge } from './AuthOwlBadge';
import { VerificationPending } from './VerificationPending';
import { LegalConsentCheckbox } from './LegalConsentCheckbox';
import { PasswordlessSignUp } from './PasswordlessSignUp';
import { PasskeySignUpCompletion } from './PasskeySignUpCompletion';
import { Busy } from './Spinner';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';
import { Waitlist } from './Waitlist';
import { resolveProjectCapabilities } from '../project-capabilities';
import { AuthOwlBranding } from './AuthOwlBranding';

export type SignUpProps = {
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
  redirectTo,
  onSignedUp,
  verifyEmailUrl,
  showBadge,
  onWaitlisted,
  showBranding = true,
}: SignUpProps = {}) {
  const t = useT();
  const toServerError = useServerError();
  const { signUp } = useSignUp();
  const { config, isLoading } = usePublicConfig();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // Legal consent: when the project requires it, the account can't be created
  // until this is ticked. It gates BOTH the password submit and the social
  // buttons (a social sign-in also creates the account), and the accepted
  // version rides along in the sign-up body so the server records + enforces it.
  const [accepted, setAccepted] = React.useState(false);
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

  function finishSignUp() {
    onSignedUp?.();
    if (redirectTo) window.location.assign(redirectTo);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (consentBlocked) {
      setError(t('signUp.error.consentRequired'));
      return;
    }
    if (password.length < passwordMinLength) {
      setError(t('common.error.passwordTooShort', { min: passwordMinLength }));
      return;
    }
    setSubmitting(true);
    try {
      const res = await authChallenge.run(AUTH_CHALLENGE_ACTIONS.signUp, (options) =>
        signUp(
          {
            email,
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
          },
          options,
        ),
      );
      if (res?.error) {
        setError(toServerError(res.error, t('signUp.error.failed')));
        return;
      }
      if (res?.data && !res.data.sessionCreated) {
        setPendingEmail(email);
        return;
      }
      if (passkeysEnabled) setCompleteWithPasskey(true);
      else finishSignUp();
    } catch {
      // Thrown errors (network, SDK internals) carry English messages - show
      // the localized generic instead.
      setError(t('signUp.error.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="ba-form" data-testid="signup-loading" aria-busy="true">
        <div className="ba-skeleton" />
        <div className="ba-skeleton" />
      </div>
    );
  }

  if (config?.signUp?.mode === 'waitlist') {
    return <Waitlist onJoined={onWaitlisted} showBadge={showBadge} showBranding={showBranding} />;
  }

  if (pendingEmail) {
    return (
      <div className="ba-form" data-testid="signup-verify-pending">
        {showBranding ? <AuthOwlBranding /> : null}
        <VerificationPending
          email={pendingEmail}
          callbackURL={verifyEmailUrl}
          method={capabilities.emailVerificationMethod}
        />
        <AuthOwlBadge force={showBadge} />
      </div>
    );
  }

  // Zero-config rendering: password registration only if the project enables it;
  // social always creates an account on first use. Fall back to password when
  // config is unavailable.
  const methods = config?.enabledMethods ?? ['password'];
  const publicSignupAllowed = config?.signUp?.mode !== 'restricted';
  // Under required consent, drop social from the sign-up surface: a social
  // sign-up's keyless OAuth callback can't carry the accepted version, so the
  // server blocks it - showing the button would only dead-end after the redirect.
  // Password sign-up captures consent; social stays a sign-IN method for existing
  // users. (A consent-required, social-only project therefore has no sign-up path,
  // surfaced as the "no methods" state below.)
  const social =
    consentRequired || !publicSignupAllowed ? [] : (config?.socialProviders ?? []);
  const showPassword =
    publicSignupAllowed
    && capabilities.passwordSignIn
    && capabilities.emailSignUp
    && capabilities.passwordSignUp;
  const showPasswordless =
    publicSignupAllowed
    && capabilities.emailOtpSignIn
    && capabilities.emailSignUp
    && !consentRequired
    && !capabilities.mfaRequired;
  const renderable = showPassword || showPasswordless || social.length > 0;

  if (completeWithPasskey) {
    return (
      <div className="ba-form" data-testid="signup-passkey-step">
        {showBranding ? <AuthOwlBranding /> : null}
        <PasskeySignUpCompletion onComplete={finishSignUp} />
        <AuthOwlBadge force={showBadge} />
      </div>
    );
  }

  return (
    <div className="ba-form" data-testid="signup-form">
      {showBranding ? <AuthOwlBranding /> : null}
      <h2 className="ba-title">{t('signUp.title')}</h2>
      <SocialButtons providers={social} callbackURL={redirectTo} />
      {showPassword && social.length > 0 && (
        <div className="ba-divider">{t('common.orDivider')}</div>
      )}
      {showPassword && (
        <form method="post" onSubmit={onSubmit} className="ba-fields">
          {capabilities.legacyNameField && (
            <label className="ba-label">
              {t('signUp.nameLabel')}
              <input
                className="ba-input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                autoComplete="name"
                required
              />
            </label>
          )}
          {capabilities.firstLastName && (
            <>
              <label className="ba-label">
                {t('signUp.firstNameLabel')}
                <input
                  className="ba-input"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    setError(null);
                  }}
                  autoComplete="given-name"
                />
              </label>
              <label className="ba-label">
                {t('signUp.lastNameLabel')}
                <input
                  className="ba-input"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    setError(null);
                  }}
                  autoComplete="family-name"
                />
              </label>
            </>
          )}
          {capabilities.collectUsername && (
            <label className="ba-label">
              {t('common.usernameLabel')}
              <input
                className="ba-input"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                }}
                autoComplete="username"
                required
              />
            </label>
          )}
          <label className="ba-label">
            {t('common.emailLabel')}
            <input
              className="ba-input"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              autoComplete="email"
              required
            />
          </label>
          <label className="ba-label">
            {t('common.passwordLabel')}
            <input
              className="ba-input"
              type="password"
              value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
              autoComplete="new-password"
              minLength={passwordMinLength}
              maxLength={passwordMaxLength}
              required
            />
          </label>
          {authChallenge.control}
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
            className="ba-button"
            type="submit"
            disabled={submitting || consentBlocked || authChallenge.configPending}
            aria-busy={submitting || undefined}
          >
            <Busy busy={submitting} label={t('signUp.submitPending')}>{t('signUp.submit')}</Busy>
          </button>
        </form>
      )}
      {showPasswordless && (showPassword || social.length > 0) && (
        <div className="ba-divider">{t('common.orDivider')}</div>
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
        <p className="ba-muted">
          {publicSignupAllowed && methods.length > 0
            ? t('signUp.empty.unsupported')
            : t('signUp.empty.none')}
        </p>
      )}
      <AuthOwlBadge force={showBadge} />
    </div>
  );
}
