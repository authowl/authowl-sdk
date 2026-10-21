'use client';
import { flushSync } from 'react-dom';
import { AuthField } from './AuthField';
import { useSlot } from '../elements';
import * as React from 'react';
import { useHandoffCompletion } from './use-handoff-completion';
import { useAuthClient, usePublicConfig, useSignIn } from '../hooks';
import { useT } from '../i18n';
import { resolveSignInMethods, emailAutocomplete, LAST_USED_TAB } from '../signin-methods';
import { currentPageHost } from './page-host';
import type { TabMethod } from '../signin-methods';
import { finishSignIn } from './finish-sign-in';
import { useSubmitAction } from './use-submit-action';
import { usePasskeyAutofill } from './passkey-autofill';
import { useSignInMethodRecorder, useLastUsedSignInMethod } from '../last-used-method';
import { StepCard } from './StepCard';
import { useAuthCardLock } from './AuthCardLock';
import { usePasskeySignIn } from './use-passkey-sign-in';
import { MethodTabs } from './MethodTabs';
import { SocialButtons } from './SocialButtons';
import { useStepFocus } from './use-step-focus';
import { ForgotPassword } from './ForgotPassword';
import { OtpCodeForm } from './OtpCodeForm';
import { MFAChallenge } from './MFAChallenge';
import { MfaEnrollmentStep, useConfirmedMfaPending } from './mfa-enrollment-step';
import { Busy } from './Spinner';
import { PhoneOTP } from './PhoneOTP';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';
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
  const usingUsername = credentialMode === 'username';
  const [otp, setOtp] = React.useState('');
  const [codeVerified, setCodeVerified] = React.useState(false);
  const [view, setView] = React.useState<'sign-in' | 'forgot' | 'otp-code' | 'magic-sent' | 'phone'>(
    'sign-in',
  );
  // A 2FA-enrolled user's password sign-in is withheld behind a second-factor
  // challenge (server returns `twoFactorRedirect`, no session), so we swap to the
  // challenge instead of finishing. AuthOwl only enrols TOTP factors (the server
  // wires `twoFactor({ issuer })` with no OTP/SMS second factor), so the withheld
  // factor is always TOTP; <MFAChallenge> covers it and offers backup codes as a
  // universal fallback.
  const [challenge, setChallenge] = React.useState(false);
  const lock = useAuthCardLock(pending);
  const { locked } = lock;
  // Hook, so it must run unconditionally - the early returns below are all after it.
  // 'clear' on an unknown answer: a sign-in form must never be replaced by an
  // enrolment screen it cannot leave. See useConfirmedMfaPending.
  const mfaEnrolment = useConfirmedMfaPending('clear');
  const step = isLoading ? 'loading' : isError ? 'error'
    : mfaEnrolment === 'confirming' ? 'mfa-confirming'
    : mfaEnrolment === 'pending' ? 'mfa-enrolment' : challenge ? 'mfa'
    : view === 'forgot' && !resetPasswordUrl || view === 'sign-in' ? 'form' : view;
  const { stepRef, rememberOpener, restoreFocus } = useStepFocus(step, !isLoading && !isError && mfaEnrolment !== 'confirming');
  const back = () => { restoreFocus(); setView('sign-in'); };
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
  const [selected, setSelected] = React.useState<TabMethod | null>(null);
  const tabId = React.useId();
  const tabMethods = plan.tabs;
  const available = (method: TabMethod | null | undefined) => method && tabMethods.includes(method) ? method : null;
  const active = available(selected) ?? available(lastUsed ? LAST_USED_TAB[lastUsed] : null) ?? tabMethods[0];
  const doPasskey = usePasskeySignIn(run, redirectTo, onPasskeySignedIn);

  // Passkey conditional autofill (progressive enhancement): armed on the single
  // shared email input whenever passkey is enabled and an email field exists.
  usePasskeyAutofill({
    enabled: !usingUsername && plan.autofillHost !== null,
    redirectTo,
    onSignedIn: onPasskeySignedIn,
  });

  const showDivider =
    plan.social.length > 0 && (tabMethods.length > 0 || plan.phoneOtp);

  const doPassword = () =>
    void run(() => authChallenge.run(
      AUTH_CHALLENGE_ACTIONS.signIn,
      (options) => usingUsername
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
        recordSignInMethod(usingUsername ? 'username' : 'password');
        if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
          setChallenge(true);
        } else {
          return finishSignIn({ sessionStore, redirectTo, onSignedIn });
        }
      },
    });
  const doMagic = () =>
    void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => signInMagicLink({ email, callbackURL: redirectTo }, options)), {
      failure: t('magicLink.error.sendFailed'),
      onSuccess: () => {
        // Parked, not recorded: sending the mail is not signing in, and
        // the link is opened later from the user's mail client.
        recordSignInMethod('magic-link', true);
        setView('magic-sent');
      },
    });
  const doRequestOtp = () =>
    void run(() => authChallenge.run(AUTH_CHALLENGE_ACTIONS.passwordless, (options) => sendEmailOtp({ email, type: 'sign-in' }, options)), {
      failure: t('emailOtp.error.sendFailed'),
      onSuccess: () => setView('otp-code'),
    });
  // SSO is a redirect out to the tenant's IdP (like a social button): no
  // Turnstile, no session mint here. `callbackURL` is REQUIRED by the server,
  // so return to the current page to redeem before the final redirect (mirrors
  // SocialButtons). A bare 404 means "no SSO connection for this domain" - map
  // it client-side (Decision 1); other failures use the standard code mapping.
  const doSso = () =>
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
    );
  const methods = {
    password: { tab: t('common.passwordLabel'), submit: t('signIn.submit'), busy: t('signIn.submitPending'), action: doPassword },
    magic: { tab: t('signIn.tab.emailLink'), submit: t('magicLink.submit'), busy: t('common.sending'), action: doMagic },
    otp: { tab: t('signIn.tab.emailCode'), submit: t('emailOtp.requestSubmit'), busy: t('common.sending'), action: doRequestOtp },
    sso: { tab: t('signIn.tab.sso'), submit: t('sso.continueWith'), busy: t('sso.redirecting'), action: doSso },
    passkey: { tab: t('signIn.tab.passkey'), submit: t('passkey.signInButton'), busy: t('passkey.waiting'), action: doPasskey, unvalidated: true },
  };
  const method = active && methods[active];
  const unvalidated = method && 'unvalidated' in method;

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
      return mfaEnrolment === 'pending' ? <MfaEnrollmentStep /> : <div className={slot('ba-skeleton')} />;
    }

    // Second-factor challenge after a withheld password sign-in. Clearing it issues
    // the session, so finish exactly as a direct sign-in would.
    if (challenge) {
      return (
        <MFAChallenge email={email || undefined} onVerified={() => finishSignIn({ sessionStore, redirectTo, onSignedIn })} />
      );
    }

    // Inline "forgot password" step: only reachable when a reset page is configured.
    if (view === 'forgot' && resetPasswordUrl) {
      return (
        <>
          <h2 className={slot('ba-title')}>{t('signIn.forgotTitle')}</h2>
          <ForgotPassword resetPasswordUrl={resetPasswordUrl} onBack={back} />
        </>
      );
    }

    // Email-OTP second stage: verify the emailed code (shares the captured email).
    if (view === 'otp-code') {
      return (
        <>
          <OtpCodeForm
            email={email}
            code={otp}
            onCodeChange={(value) => {
              setOtp(value);
              setError(null);
            }}
            pending={locked}
            error={error}
            success={codeVerified}
            onSubmit={() =>
              void run(() => signInEmailOtp({ email, otp }), {
                failure: t('emailOtp.error.invalidCode'),
                onSuccess: () => {
                  flushSync(() => setCodeVerified(true));
                  recordSignInMethod('email-otp');
                  finishSignIn({ sessionStore, redirectTo, onSignedIn });
                },
              })
            }
            onChangeEmail={() => {
              setOtp('');
              setCodeVerified(false);
              setError(null);
              back();
            }}
          />
        </>
      );
    }

    // Magic-link confirmation: no session is issued here (the link does it), so
    // this is a terminal message with a way back.
    if (view === 'magic-sent') {
      return (
        <>
          <p role="status" className={slot('ba-muted')}>{t('magicLink.sent')}</p>
          <button type="button" className={slot('ba-link-button')} onClick={back}>
            <span className={slot('ba-icon-back')} aria-hidden="true">←</span> {t('forgotPassword.backToSignIn')}
          </button>
        </>
      );
    }

    if (view === 'phone') {
      return (
        <PhoneOTP
          redirectTo={redirectTo}
          onSignedIn={onPhoneOtpSignedIn}
          onBack={back}
          onMfaPasswordRequired={() => {
            restoreFocus(null);
            setSelected('password');
            setCredentialMode('email');
            setView('sign-in');
            setError(t('serverError.TWO_FACTOR_REQUIRED'));
          }}
        />
      );
    }

    return (
      <>
        <InvitationBanner />
        <SocialButtons providers={plan.social} lastUsed={lastUsed} />
        {showDivider && <div className={slot('ba-divider')}>{t('common.orDivider')}</div>}
        {tabMethods.length > 0 && (
          <form
            method="post"
            noValidate={unvalidated}
            className={slot('ba-fields')}
            onSubmit={(e) => {
              e.preventDefault();
              if (locked || !active) return;
              setSelected(active);
              method?.action();
            }}
          >
            {tabMethods.length > 1 && (
              <MethodTabs id={tabId} methods={tabMethods} active={active!} labels={methods} onChange={(method) => { setSelected(method); setCredentialMode('email'); setError(null); }} />
            )}
            {plan.primary !== null && active !== 'passkey' && (
              <AuthField
                label={t(usingUsername ? 'common.usernameLabel' : 'common.emailLabel')}
                type={usingUsername ? 'text' : 'email'}
                autoComplete={usingUsername ? 'username' : emailAutocomplete(plan.autofillHost !== null)}
                value={usingUsername ? username : email}
                onChange={(e) => {
                  (usingUsername ? setUsername : setEmail)(e.target.value);
                  setError(null);
                }}
                required={!unvalidated}
              />
            )}
            <div className={slot('ba-fields')} role={tabMethods.length > 1 ? 'tabpanel' : undefined} id={`${tabId}-panel`} aria-labelledby={tabMethods.length > 1 ? `${tabId}-tab-${active}` : undefined}>
              {active === 'password' && (
                <div className={slot('ba-label')}>
                  <div className={slot('ba-label-row')}>
                    <label htmlFor={`${tabId}-password`}>{t('common.passwordLabel')}</label>
                    {resetPasswordUrl && (
                      <button id={`${tabId}-forgot`} type="button" className={slot('ba-link-button')} disabled={locked} onClick={(event) => { rememberOpener(event.currentTarget); setView('forgot'); }}>{t('signIn.forgotLink')}</button>
                    )}
                  </div>
                  <input
                    id={`${tabId}-password`}
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
                </div>
              )}
              {active === 'otp' && <p className={slot('ba-method-help')}>{t('signIn.emailCodeHelp')}</p>}
              {active === 'passkey' && (
                <div className={slot('ba-passkey-info')}>
                  <strong>{t('signIn.passkeyTitle')}</strong>
                  <p className={slot('ba-method-help')}>{t('signIn.passkeyHelp')}</p>
                </div>
              )}
              {authChallenge.control}
              <FormError>{error}</FormError>
              <button id={`${tabId}-submit`} className={slot('ba-button')} type="submit" disabled={locked || (!unvalidated && authChallenge.configPending)} onClick={(event) => { if (document.activeElement === event.currentTarget) rememberOpener(event.currentTarget); }} aria-busy={pending || undefined}>
                <Busy busy={pending} label={method?.busy}>{method?.submit}</Busy>
              </button>
            </div>
            {plan.username && active === 'password' && (
              <button
                type="button"
                className={slot('ba-link-button')}
                disabled={locked}
                onClick={() => {
                  setError(null);
                  setCredentialMode((current) =>
                    current === 'email' ? 'username' : 'email');
                }}
              >
                {!usingUsername
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
            id={`${tabId}-phone`}
            disabled={locked}
            onClick={(event) => { rememberOpener(event.currentTarget); setView('phone'); }}
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
      </>
    );
  }

  return (
    <StepCard lock={lock} key={step} step={step} kind="signIn" stepRef={stepRef} showBadge={showBadge} showBranding={showBranding}>
      {renderStep()}
    </StepCard>
  );
}
