'use client';
import { useSlot } from '../elements';
import * as React from 'react';
import { useHandoffCompletion } from './use-handoff-completion';
import { useAuthClient, usePublicConfig, useSignIn } from '../hooks';
import { useT } from '../i18n';
import { resolveSignInMethods, emailAutocomplete } from '../signin-methods';
import { currentPageHost } from './page-host';
import type { SignInPrimary } from '../signin-methods';
import { finishSignIn } from './finish-sign-in';
import { useSubmitAction } from './use-submit-action';
import { usePasskeyAutofill } from './passkey-autofill';
import { useSignInMethodRecorder, useLastUsedSignInMethod } from '../last-used-method';
import { MethodTabs } from './MethodTabs';
import { SocialButtons } from './SocialButtons';
import { PasskeyButton } from './PasskeyButton';
import { ForgotPassword } from './ForgotPassword';
import { OtpCodeForm } from './OtpCodeForm';
import { MFAChallenge } from './MFAChallenge';
import { MfaEnrollmentStep, useConfirmedMfaPending } from './mfa-enrollment-step';
import { AuthOwlBadge } from './AuthOwlBadge';
import { Busy } from './Spinner';
import { PhoneOTP } from './PhoneOTP';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';
import { AuthOwlBranding } from './AuthOwlBranding';
import { InvitationBanner } from './InvitationBanner';
import { PublicConfigError } from './PublicConfigError';

export type SignInProps = {
  redirectTo?: string;
  /** Optional callback after successful sign-in. */
  onSignedIn?: () => void;
  /**
   * URL of your reset page (where <ResetPassword/> is mounted). When set and
   * password sign-in is enabled, a "Forgot password?" link appears that switches
   * to an inline reset-request form. Omit it to hide the link.
   */
  resetPasswordUrl?: string;
  /**
   * Force the "Secured by AuthOwl" badge on even when the plan would hide it
   * (paid/comped projects). Free projects always show it regardless.
   */
  showBadge?: boolean;
  /** Hide the project header when the host surface renders the same branding itself. */
  showBranding?: boolean;
};

export function SignIn({
  redirectTo,
  onSignedIn,
  resetPasswordUrl,
  showBadge,
  showBranding = true,
}: SignInProps = {}) {
  const slot = useSlot();
  const t = useT();
  const { sessionStore } = useAuthClient();
  const {
    signIn,
    signInUsername,
    signInMagicLink,
    sendEmailOtp,
    signInEmailOtp,
    signInSso,
  } = useSignIn();
  const { config, isLoading, isError } = usePublicConfig();
  const { pending, error, setError, run } = useSubmitAction();
  useHandoffCompletion(redirectTo, onSignedIn, () => setError(t('signIn.error.failed')));
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [credentialMode, setCredentialMode] = React.useState<'email' | 'username'>('email');
  const [otp, setOtp] = React.useState('');
  const [view, setView] = React.useState<'sign-in' | 'forgot' | 'otp-code' | 'magic-sent' | 'phone'>(
    'sign-in',
  );
  // Which action is in flight, so the busy label ("Signing in…"/"Sending…") lands
  // on the button the user pressed - `pending` alone is shared across methods.
  const [, setInFlight] = React.useState<SignInPrimary>(null);
  // A 2FA-enrolled user's password sign-in is withheld behind a second-factor
  // challenge (server returns `twoFactorRedirect`, no session), so we swap to the
  // challenge instead of finishing. AuthOwl only enrols TOTP factors (the server
  // wires `twoFactor({ issuer })` with no OTP/SMS second factor), so the withheld
  // factor is always TOTP; <MFAChallenge> covers it and offers backup codes as a
  // universal fallback.
  const [challenge, setChallenge] = React.useState(false);
  // Hook, so it must run unconditionally - the early returns below are all after it.
  // 'clear' on an unknown answer: a sign-in form must never be replaced by an
  // enrolment screen it cannot leave. See useConfirmedMfaPending.
  const mfaEnrolment = useConfirmedMfaPending('clear');
  const emailRef = React.useRef<HTMLInputElement>(null);
  const recordSignInMethod = useSignInMethodRecorder();
  const onPasskeySignedIn = React.useCallback(() => {
    recordSignInMethod('passkey');
    onSignedIn?.();
  }, [onSignedIn, recordSignInMethod]);
  const onPhoneOtpSignedIn = React.useCallback(() => {
    recordSignInMethod('phone-otp');
    onSignedIn?.();
  }, [onSignedIn, recordSignInMethod]);

  // Zero-config: render exactly what the project enabled. Resolution is a pure,
  // tested helper. A failed request returns the fail-closed UI below, so this
  // structural null default is never presented as real project configuration.
  // The page host decides whether a passkey ceremony is reachable at all (see
  // `passkeyBlockingDomain`), so it has to come from the render environment.
  const plan = resolveSignInMethods(config, currentPageHost());

  const lastUsed = useLastUsedSignInMethod();
  type TabMethod = Exclude<SignInPrimary, null> | 'passkey';
  const [selected, setSelected] = React.useState<TabMethod | null>(null);
  const tabId = React.useId();
  const tabMethods: TabMethod[] = [
    ...(plan.password || plan.username ? ['password' as const] : []),
    ...(plan.magicLink ? ['magic' as const] : []),
    ...(plan.emailOtp ? ['otp' as const] : []),
    ...(plan.sso ? ['sso' as const] : []),
    ...(plan.passkey ? ['passkey' as const] : []),
  ];
  const active = selected && tabMethods.includes(selected) ? selected : plan.primary ?? tabMethods[0];
  React.useEffect(() => {
    const method = lastUsed === 'magic-link' ? 'magic' : lastUsed === 'email-otp' ? 'otp'
      : lastUsed === 'username' ? 'password' : lastUsed;
    if (method === 'password' || method === 'magic' || method === 'otp' || method === 'sso' || method === 'passkey') {
      setSelected(method);
    }
  }, [lastUsed]);

  // Passkey conditional autofill (progressive enhancement): armed on the single
  // shared email input whenever passkey is enabled and an email field exists.
  usePasskeyAutofill({
    enabled: credentialMode === 'email' && plan.autofillHost !== null,
    redirectTo,
    onSignedIn: onPasskeySignedIn,
  });

  const badge = <AuthOwlBadge force={showBadge} />;
  const branding = showBranding ? <AuthOwlBranding /> : null;

  if (isLoading) {
    return (
      <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-loading" aria-busy="true">
        <div className={slot('ba-skeleton')} />
        <div className={slot('ba-skeleton')} />
      </div>
    );
  }

  if (isError) {
    return <PublicConfigError showBadge={showBadge} showBranding={showBranding} />;
  }

  // Required-MFA enrolment, the OTHER way a password sign-in can succeed without
  // producing a usable session. On a project with "Require MFA for everyone" a
  // factor-less user's session is held at enrolment, and a held session reads as
  // signed OUT - so <SignedOut> keeps this component mounted and, without this
  // branch, we re-render the sign-in form on top of a sign-in that WORKED. To the
  // user the page just blinks and nothing happens, in every browser, and the only
  // escape was for the app to have already adopted <MFARequiredGate/>. Enrolling
  // here means turning the dashboard toggle on cannot brick an app's sign-in.
  //
  // Checked before `challenge` because they are mutually exclusive: the challenge
  // path belongs to a user who ALREADY has a factor, enrolment to one who has
  // none.
  if (mfaEnrolment !== 'clear') {
    return (
      <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-mfa-enrolment" aria-busy={mfaEnrolment === 'confirming'}>
        {branding}
        {mfaEnrolment === 'pending' ? <MfaEnrollmentStep /> : <div className={slot('ba-skeleton')} />}
        {badge}
      </div>
    );
  }

  // Second-factor challenge after a withheld password sign-in. Clearing it issues
  // the session, so finish exactly as a direct sign-in would.
  if (challenge) {
    return (
      <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-mfa">
        {branding}
        <MFAChallenge onVerified={() => finishSignIn({ sessionStore, redirectTo, onSignedIn })} />
        {badge}
      </div>
    );
  }

  // Inline "forgot password" step: only reachable when a reset page is configured.
  if (view === 'forgot' && resetPasswordUrl) {
    return (
      <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-forgot">
        {branding}
        <h2 className={slot('ba-title')}>{t('signIn.forgotTitle')}</h2>
        <ForgotPassword resetPasswordUrl={resetPasswordUrl} onBack={() => setView('sign-in')} />
        {badge}
      </div>
    );
  }

  // Email-OTP second stage: verify the emailed code (shares the captured email).
  if (view === 'otp-code') {
    return (
      <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-otp-code">
        {branding}
        <h2 className={slot('ba-title')}>{t('signIn.title')}</h2>
        <OtpCodeForm
          email={email}
          code={otp}
          onCodeChange={(value) => {
            setOtp(value);
            setError(null);
          }}
          pending={pending}
          error={error}
          onSubmit={() =>
            void run(() => signInEmailOtp({ email, otp }), {
              failure: t('emailOtp.error.invalidCode'),
              onSuccess: () => {
                recordSignInMethod('email-otp');
                finishSignIn({ sessionStore, redirectTo, onSignedIn });
              },
            })
          }
          onChangeEmail={() => {
            setOtp('');
            setError(null);
            setView('sign-in');
          }}
        />
        {badge}
      </div>
    );
  }

  // Magic-link confirmation: no session is issued here (the link does it), so
  // this is a terminal message with a way back.
  if (view === 'magic-sent') {
    return (
      <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-magic-sent">
        {branding}
        <h2 className={slot('ba-title')}>{t('signIn.title')}</h2>
        <p className={slot('ba-muted')}>{t('magicLink.sent')}</p>
        <button type="button" className={slot('ba-link-button')} onClick={() => setView('sign-in')}>
          <span className={slot('ba-icon-back')} aria-hidden="true">←</span> {t('forgotPassword.backToSignIn')}
        </button>
        {badge}
      </div>
    );
  }

  if (view === 'phone') {
    return (
      <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-phone">
        {branding}
        <PhoneOTP
          redirectTo={redirectTo}
          onSignedIn={onPhoneOtpSignedIn}
          onBack={() => setView('sign-in')}
          onMfaPasswordRequired={() => {
            setSelected('password');
            setCredentialMode('email');
            setView('sign-in');
            setError(t('serverError.TWO_FACTOR_REQUIRED'));
            requestAnimationFrame(() => emailRef.current?.focus());
          }}
        />
        {badge}
      </div>
    );
  }

  const hasEmailMethod = plan.password || plan.magicLink || plan.emailOtp || plan.sso;
  const hasCredentialForm = hasEmailMethod || plan.username;
  const showDivider =
    plan.social.length > 0 && (hasCredentialForm || plan.passkey || plan.phoneOtp);

  // One `run` per action, tagged so the busy label targets the pressed button.
  const start = (key: Exclude<SignInPrimary, null>, action: () => void) => {
    setInFlight(key);
    action();
  };
  const doPassword = () =>
    start('password', () =>
      void run(() => authChallenge.run(
        AUTH_CHALLENGE_ACTIONS.signIn,
        (options) => credentialMode === 'username'
          ? signInUsername({ username, password }, options)
          : signIn({ email, password }, options),
      ), {
        failure: t('signIn.error.failed'),
        onSuccess: (res) => {
          // `signIn.email` resolves to EmailAuthData | TwoFactorRedirectData; for
          // a 2FA-enrolled user the session is withheld and `data` is the redirect
          // member - swap to the challenge instead of finishing.
          const data = res.data;
          // Password was right even when the session is withheld for a second
          // factor. That factor is not an alternative sign-in method.
          recordSignInMethod(credentialMode === 'username' ? 'username' : 'password');
          if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
            setChallenge(true);
          } else {
            return finishSignIn({ sessionStore, redirectTo, onSignedIn });
          }
        },
      }),
    );
  const doMagic = () =>
    start('magic', () =>
      void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => signInMagicLink({ email, callbackURL: redirectTo }, options)), {
        failure: t('magicLink.error.sendFailed'),
        onSuccess: () => {
          // Parked, not recorded: sending the mail is not signing in, and
          // the link is opened later from the user's mail client.
          recordSignInMethod('magic-link', true);
          setView('magic-sent');
        },
      }),
    );
  const doRequestOtp = () =>
    start('otp', () =>
      void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => sendEmailOtp({ email, type: 'sign-in' }, options)), {
        failure: t('emailOtp.error.sendFailed'),
        onSuccess: () => setView('otp-code'),
      }),
    );
  // SSO is a redirect out to the tenant's IdP (like a social button): no
  // Turnstile, no session mint here. `callbackURL` is REQUIRED by the server,
  // so return to the current page to redeem before the final redirect (mirrors
  // SocialButtons). A bare 404 means "no SSO connection for this domain" - map
  // it client-side (Decision 1); other failures use the standard code mapping.
  const doSso = () =>
    start('sso', () =>
      void run(
        () => signInSso({ email, callbackURL: window.location.href }),
        {
          failure: t('sso.error.startFailed'),
          mapError: (error) => (error.status === 404 ? t('sso.error.notFound') : null),
          onSuccess: () => recordSignInMethod('sso', true),
          // SSO always redirects the browser to the IdP; keep the spinner up
          // through that navigation instead of flashing back to idle.
          keepPendingOnSuccess: true,
        },
      ),
    );
  const PRIMARY_ACTION = { password: doPassword, magic: doMagic, otp: doRequestOtp, sso: doSso };

  const tabLabels = {
    password: t('common.passwordLabel'), magic: t('signIn.tab.emailLink'),
    otp: t('signIn.tab.emailCode'), sso: t('signIn.tab.sso'), passkey: t('signIn.tab.passkey'),
  };
  const activeLabel = active === 'magic' ? t('magicLink.submit') : active === 'otp'
    ? t('emailOtp.requestSubmit') : active === 'sso' ? t('sso.continueWith') : t('signIn.submit');

  return (
    <div key={view} className={slot('ba-form ba-card ba-auth-card ba-step')} data-testid="signin-form">
      <header className={slot('ba-auth-header')}>
        {branding}
        <h2 className={slot('ba-title')}>{t('signIn.title')}</h2>
        <p className={slot('ba-subtitle')}>{t('signIn.subtitle')}</p>
      </header>
      <InvitationBanner />
      <SocialButtons providers={plan.social} />
      {showDivider && <div className={slot('ba-divider')}>{t('common.orDivider')}</div>}
      {tabMethods.length > 0 && (
        <form
          method="post"
          className={slot('ba-fields')}
          onSubmit={(e) => {
            e.preventDefault();
            if (active === 'passkey') e.currentTarget.querySelector<HTMLButtonElement>('[data-testid=passkey-button]')?.click();
            else if (active) PRIMARY_ACTION[active]();
          }}
        >
          {tabMethods.length > 1 && (
            <MethodTabs id={tabId} methods={tabMethods} active={active} labels={tabLabels} onChange={(method) => { setSelected(method); setCredentialMode('email'); setError(null); }} />
          )}
          {hasCredentialForm && (credentialMode === 'email' ? (
            <label className={slot('ba-label')}>
              {t('common.emailLabel')}
              <input
                ref={emailRef}
                className={slot('ba-input')}
                type="email"
                autoComplete={emailAutocomplete(plan.autofillHost !== null)}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                required={active !== 'passkey'}
              />
            </label>
          ) : (
            <label className={slot('ba-label')}>
              {t('common.usernameLabel')}
              <input
                className={slot('ba-input')}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                }}
                required={active !== 'passkey'}
              />
            </label>
          ))}
          <div className={slot('ba-fields')} role={tabMethods.length > 1 ? 'tabpanel' : undefined} id={`${tabId}-panel-${active}`} aria-labelledby={tabMethods.length > 1 ? `${tabId}-tab-${active}` : undefined}>
          {active === 'password' && (
            <label className={slot('ba-label')}>
              {t('common.passwordLabel')}
              <input
                className={slot('ba-input')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                required
              />
            </label>
          )}
          {authChallenge.control}
          <FormError>{error}</FormError>
          {active === 'passkey' ? (
            <PasskeyButton redirectTo={redirectTo} onSignedIn={onPasskeySignedIn} />
          ) : (
            <button className={slot('ba-button')} type="submit" disabled={pending || authChallenge.configPending} aria-busy={pending || undefined}>
              <Busy busy={pending} label={active === 'password' ? t('signIn.submitPending') : active === 'sso' ? t('sso.redirecting') : t('common.sending')}>{activeLabel}</Busy>
            </button>
          )}
          {active === 'password' && resetPasswordUrl && (
            <button type="button" className={slot('ba-link-button')} onClick={() => setView('forgot')}>{t('signIn.forgotLink')}</button>
          )}
          </div>
          {tabMethods.filter((method) => method !== active).map((method) => <div key={method} role="tabpanel" hidden id={`${tabId}-panel-${method}`} aria-labelledby={`${tabId}-tab-${method}`} />)}
          {plan.username && active === 'password' && (
            <button
              type="button"
              className={slot('ba-link-button')}
              disabled={pending}
              onClick={() => {
                setError(null);
                setCredentialMode((current) =>
                  current === 'email' ? 'username' : 'email');
              }}
            >
              {credentialMode === 'email'
                ? t('signIn.useUsername')
                : t('signIn.useEmail')}
            </button>
          )}
        </form>
      )}
      {plan.phoneOtp && (
        <button
          type="button"
          className={slot('ba-link-button')}
          onClick={() => setView('phone')}
        >
          {t('phoneOtp.usePhone')}
        </button>
      )}
      {!plan.renderable && (
        <p className={slot('ba-muted')}>
          {plan.emptyReason === 'unsupported'
            ? t('signIn.empty.unsupported')
            : t('signIn.empty.none')}
        </p>
      )}
      {badge}
    </div>
  );
}
