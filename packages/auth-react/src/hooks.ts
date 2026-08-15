'use client';
import * as React from 'react';
import {
  createMembershipHas,
  type AuthClientError,
  type AuthUser,
  type AuthOwlClient,
  type ConsentStatus,
  type HasParams,
  type OrganizationDetails,
  type OrganizationMembership,
  type PublicConfig,
  type SessionState,
} from '@authowl/core';
import { useAuthOwlContext } from './provider';
import { sessionAuthState } from './components/auth-state';

export function useAuthClient(): AuthOwlClient {
  return useAuthOwlContext().client;
}

export type UseAccountResult = AuthOwlClient['account'];

/** Signed-in account profile, credential, session, provider, and deletion actions. */
export function useAccount(): UseAccountResult {
  return useAuthClient().account;
}

export type UsePublicConfigResult = {
  config: PublicConfig | null;
  isLoading: boolean;
  isError: boolean;
};

/** The project's fetched public config (enabled methods, social providers, branding). */
export function usePublicConfig(): UsePublicConfigResult {
  const { config, configState } = useAuthOwlContext();
  return {
    config,
    isLoading: configState === 'loading',
    isError: configState === 'error',
  };
}

export function useSession(): SessionState {
  const client = useAuthClient();
  return React.useSyncExternalStore(
    client.sessionStore.subscribe,
    client.sessionStore.getSnapshot,
    client.sessionStore.getSnapshot,
  );
}

export type UseUserResult = {
  /**
   * Stays populated for a session held at required-MFA enrolment even though
   * `isSignedIn` is false - <MFARequiredGate/>'s enrolment UI needs it.
   * Gate app content on `isSignedIn`, not on `user`.
   */
  user: AuthUser | null;
  isLoaded: boolean;
  /** False for a session held at required-MFA enrolment (CONTRACTS §5). */
  isSignedIn: boolean;
  /** The signed-in-enough-to-enrol state: route to <MFARequiredGate/>. */
  needsMfaEnrollment: boolean;
  error: AuthClientError | null;
};

export function useUser(): UseUserResult {
  const { data, isPending, error } = useSession();
  const state = sessionAuthState(data);
  return {
    user: data?.user ?? null,
    isLoaded: !isPending,
    isSignedIn: state.isSignedIn,
    needsMfaEnrollment: state.needsMfaEnrollment,
    error: error ?? null,
  };
}

export type UseAuthResult = {
  /** False while the session is still being fetched. */
  isLoaded: boolean;
  isSignedIn: boolean;
  /** The signed-in user's id, else null. Consumers key token freshness on it. */
  userId: string | null;
  /** Active organization id (when the organization plugin is in use), else null. */
  orgId: string | null;
  /**
   * Clerk-compatible: mint a short-lived JWT for third-party backends
   * (Convex/Supabase/Hasura). Requires the project's JWT issuer toggle.
   * Resolves null when signed out. Named templates use
   * `{ template: 'convex' }`; `forceRefresh` bypasses only the selected entry.
   */
  getToken: AuthOwlClient['getToken'];
};

/**
 * Clerk-compatible auth snapshot + token minting. This is the hook
 * `<ConvexProviderWithAuthOwl useAuth={useAuth}>` consumes - its shape mirrors
 * what Clerk's `useAuth` provides to `ConvexProviderWithClerk`, so swapping
 * providers is a one-line change.
 */
export function useAuth(): UseAuthResult {
  const client = useAuthClient();
  const { data, isPending } = useSession();
  // Pending-MFA sessions read as signed out here too - consistent with
  // useUser, and their getToken would be refused server-side anyway.
  return {
    isLoaded: !isPending,
    isSignedIn: sessionAuthState(data).isSignedIn,
    userId: data?.user?.id ?? null,
    orgId: data?.session?.activeOrganizationId ?? null,
    getToken: client.getToken,
  };
}

export type UseOrganizationResult = {
  /** The active organization's full details (members + invitations), or null. */
  organization: OrganizationDetails | null;
  /** The active-org membership: canonical role + advisory permission claim, or null. */
  membership: OrganizationMembership | null;
  /**
   * Team ids the member holds in the active organization, from the session claim.
   * Empty when they hold none; empty also when the session predates teams, so treat
   * it as "no proven teams" rather than proof of absence.
   *
   * Teams are pure grouping - membership grants nothing by itself.
   */
  teams: string[];
  /** The member's active team within the active organization, or null. */
  activeTeamId: string | null;
  /**
   * Clerk-style `has({ role?, permission?, teamId? })` bound to the active
   * membership. PURE + advisory (reads the local session claim, never the server) -
   * gate real authorization server-side over the verified token
   * (`@authowl/next` `has()`).
   */
  has: (params: HasParams) => boolean;
  /** `hasPermission({ permission })` bound to the active membership. Pure + advisory. */
  hasPermission: (params: { permission: string }) => boolean;
  /** False until the session (and, when there is an active org, its details) has loaded. */
  isLoaded: boolean;
};

/**
 * Active organization, its membership, and a bound `has()` - the permission-aware
 * companion to <Protect role|permission>. `membership`/`has` resolve
 * synchronously from the session claim (no fetch); `organization` is loaded from
 * the active org when one is set. Advisory, like the rest of the client surface.
 */
export function useOrganization(): UseOrganizationResult {
  const client = useAuthClient();
  const apiRef = React.useRef(client.organization);
  apiRef.current = client.organization;
  const { data, isPending } = useSession();
  const membership = data?.session?.membership ?? null;
  const activeOrganizationId = data?.session?.activeOrganizationId ?? null;
  const identity = data?.user?.id ?? null;

  const [organization, setOrganization] = React.useState<OrganizationDetails | null>(null);
  const [orgLoaded, setOrgLoaded] = React.useState(false);
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    const token = ++requestRef.current;
    setOrganization(null);
    setOrgLoaded(false);
    if (isPending) return;
    if (!identity || !activeOrganizationId) {
      setOrgLoaded(true);
      return;
    }
    void (async () => {
      try {
        const result = await apiRef.current.get({ organizationId: activeOrganizationId });
        if (token !== requestRef.current) return;
        setOrganization(result.data ?? null);
      } catch {
        if (token === requestRef.current) setOrganization(null);
      } finally {
        if (token === requestRef.current) setOrgLoaded(true);
      }
    })();
    return () => {
      requestRef.current += 1;
    };
  }, [identity, activeOrganizationId, isPending]);

  const bound = React.useMemo(() => createMembershipHas(membership), [membership]);
  return {
    organization,
    membership,
    teams: membership?.teams ?? [],
    // AuthOwl nulls this server-side when the stored pointer names a team the
    // member no longer holds, so it never needs re-validating here.
    activeTeamId: data?.session?.activeTeamId ?? null,
    has: bound.has,
    hasPermission: bound.hasPermission,
    isLoaded: !isPending && orgLoaded,
  };
}

export type UseSignInResult = {
  /** Email + password sign-in. */
  signIn: AuthOwlClient['signIn']['email'];
  /** Username + password sign-in. */
  signInUsername: AuthOwlClient['signIn']['username'];
  /** Social provider sign-in (Google, GitHub, etc). */
  signInSocial: AuthOwlClient['signIn']['social'];
  /** Enterprise SSO (OIDC/SAML) sign-in - redirects to the tenant's IdP. */
  signInSso: AuthOwlClient['signIn']['sso'];
  /** Passwordless: email a one-time sign-in link. */
  signInMagicLink: AuthOwlClient['signIn']['magicLink'];
  /** Passwordless: sign in with a registered passkey (WebAuthn). */
  signInPasskey: AuthOwlClient['signIn']['passkey'];
  /** Passwordless: request an emailed one-time code. */
  sendEmailOtp: AuthOwlClient['emailOtp']['sendVerificationOtp'];
  /** Passwordless: complete sign-in with the emailed code. */
  signInEmailOtp: AuthOwlClient['signIn']['emailOtp'];
  /** Managed SMS: request a phone verification code. */
  preparePhoneOtp: AuthOwlClient['phoneOtp']['prepare'];
  /** Managed SMS: request a phone verification code. */
  startPhoneOtp: AuthOwlClient['phoneOtp']['start'];
  /** Managed SMS: verify the phone code and establish a session. */
  verifyPhoneOtp: AuthOwlClient['phoneOtp']['verify'];
};

export function useSignIn(): UseSignInResult {
  const client = useAuthClient();
  return {
    signIn: client.signIn.email,
    signInUsername: client.signIn.username,
    signInSocial: client.signIn.social,
    signInSso: client.signIn.sso,
    signInMagicLink: client.signIn.magicLink,
    signInPasskey: client.signIn.passkey,
    sendEmailOtp: client.emailOtp.sendVerificationOtp,
    signInEmailOtp: client.signIn.emailOtp,
    preparePhoneOtp: client.phoneOtp.prepare,
    startPhoneOtp: client.phoneOtp.start,
    verifyPhoneOtp: client.phoneOtp.verify,
  };
}

export type UsePasskeysResult = {
  /** List the signed-in user's registered passkeys. */
  listPasskeys: AuthOwlClient['passkey']['listUserPasskeys'];
  /** Register a new passkey for the signed-in user. */
  addPasskey: AuthOwlClient['passkey']['addPasskey'];
  /** Rename an existing passkey. */
  updatePasskey: AuthOwlClient['passkey']['updatePasskey'];
  /** Remove an existing passkey. */
  deletePasskey: AuthOwlClient['passkey']['deletePasskey'];
};

/** Passkey management for the signed-in user (drives {@link PasskeyManager}). */
export function usePasskeys(): UsePasskeysResult {
  const client = useAuthClient();
  return {
    listPasskeys: client.passkey.listUserPasskeys,
    addPasskey: client.passkey.addPasskey,
    updatePasskey: client.passkey.updatePasskey,
    deletePasskey: client.passkey.deletePasskey,
  };
}

export type UseMFAResult = {
  /** Begin TOTP enrolment (password-gated): returns the TOTP URI + backup codes. */
  enable: AuthOwlClient['twoFactor']['enable'];
  /** Turn two-factor off for the signed-in user (password-gated). */
  disable: AuthOwlClient['twoFactor']['disable'];
  /** Verify a TOTP code: activates a pending factor, or clears a sign-in challenge. */
  verifyTotp: AuthOwlClient['twoFactor']['verifyTotp'];
  /** Clear a sign-in challenge with a single-use backup code. */
  verifyBackupCode: AuthOwlClient['twoFactor']['verifyBackupCode'];
  /** Email a fallback second-factor code for the pending challenge (lost authenticator). */
  sendOtp: AuthOwlClient['twoFactor']['sendOtp'];
  /** Clear a sign-in challenge with the emailed fallback code. */
  verifyOtp: AuthOwlClient['twoFactor']['verifyOtp'];
  /** Regenerate the backup codes (password-gated), invalidating the previous set. */
  regenerateBackupCodes: AuthOwlClient['twoFactor']['generateBackupCodes'];
};

/** TOTP two-factor actions (drives <MFAEnrollment/> and <MFAChallenge/>). */
export function useMFA(): UseMFAResult {
  const client = useAuthClient();
  return {
    enable: client.twoFactor.enable,
    disable: client.twoFactor.disable,
    verifyTotp: client.twoFactor.verifyTotp,
    verifyBackupCode: client.twoFactor.verifyBackupCode,
    sendOtp: client.twoFactor.sendOtp,
    verifyOtp: client.twoFactor.verifyOtp,
    regenerateBackupCodes: client.twoFactor.generateBackupCodes,
  };
}

export type UsePasswordResetResult = {
  /** Email a reset link to the user. */
  requestPasswordReset: AuthOwlClient['requestPasswordReset'];
  /** Set a new password with the token from the reset link. */
  resetPassword: AuthOwlClient['resetPassword'];
};

/** Password-reset actions (drives <ForgotPassword/> and <ResetPassword/>). */
export function usePasswordReset(): UsePasswordResetResult {
  const client = useAuthClient();
  return { requestPasswordReset: client.requestPasswordReset, resetPassword: client.resetPassword };
}

export type UseEmailVerificationResult = {
  /** (Re)send the email-verification link. */
  sendVerificationEmail: AuthOwlClient['sendVerificationEmail'];
  /** Send an email ownership-verification code. */
  sendVerificationCode: AuthOwlClient['emailOtp']['sendVerificationOtp'];
  /** Verify an email ownership code. */
  verifyEmailCode: AuthOwlClient['emailOtp']['verifyEmail'];
};

/** Email-verification actions for link and code ceremonies. */
export function useEmailVerification(): UseEmailVerificationResult {
  const client = useAuthClient();
  return {
    sendVerificationEmail: client.sendVerificationEmail,
    sendVerificationCode: client.emailOtp.sendVerificationOtp,
    verifyEmailCode: client.emailOtp.verifyEmail,
  };
}

export type UseConsentResult = {
  /** Consent status is still being fetched. */
  isLoading: boolean;
  /** The signed-in user must (re-)accept the current terms version to continue. */
  needsConsent: boolean;
  /** Full status (version + doc URLs) once loaded. */
  status: ConsentStatus | null;
  /** Record acceptance of the current version, then refresh (clears needsConsent). */
  accept: () => Promise<void>;
  /** Re-fetch the status (e.g. after the user navigates back). */
  refresh: () => Promise<void>;
};

/**
 * Legal-consent status for the signed-in user, driving the re-consent gate: when
 * the operator bumps the terms version, `needsConsent` flips true until the user
 * accepts. Re-fetches when the signed-in identity changes (sign-in/out). Used by
 * <ConsentGate/>; also usable standalone.
 */
export function useConsent(): UseConsentResult {
  const client = useAuthClient();
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? null;
  const [status, setStatus] = React.useState<ConsentStatus | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  // Monotonic token so ONLY the most-recently-started load may write state. Every
  // path that fetches (the effect, the exposed refresh, accept's re-sync) bumps
  // and checks it, so a slow request can't clobber a newer one - decisive across
  // an identity switch, where user A's in-flight status must not overwrite B's.
  const reqRef = React.useRef(0);

  // Fail OPEN on the client gate: a transient status error must never lock the
  // user out of the app. Recording + enforcement still hold server-side.
  const load = React.useCallback(async () => {
    const reqId = ++reqRef.current;
    setIsLoading(true);
    let next: ConsentStatus;
    try {
      next = await client.getConsentStatus();
    } catch {
      next = { required: false };
    }
    if (reqId !== reqRef.current) return; // a newer load superseded this one
    setStatus(next);
    setIsLoading(false);
  }, [client]);

  // Re-fetch when the signed-in identity changes (sign-in/out). EVERY transition -
  // including the session going pending (isLoaded false) mid sign-out/in - bumps the
  // token (so any in-flight load from the old identity is dropped, never writing the
  // wrong user's status) and clears status. While the session is still settling we
  // stay in the loading/fail-open state rather than showing a stale gate.
  React.useEffect(() => {
    reqRef.current += 1;
    setStatus(null);
    if (!isLoaded) {
      setIsLoading(true);
      return;
    }
    void load();
  }, [load, isLoaded, userId]);

  // A gateable version must be a real finite number: getConsentStatus casts raw
  // JSON without validation, so a schema-skewed `version: "2"` must NOT gate (it
  // would post a string and, on rejection, deadlock the gate). Anything non-numeric
  // fails OPEN.
  const version =
    typeof status?.version === 'number' && Number.isFinite(status.version) ? status.version : null;
  const accept = React.useCallback(async () => {
    if (version == null) return; // nothing acceptable until a numeric version resolves
    try {
      await client.acceptConsent(version);
    } finally {
      // Re-sync even on failure: if the operator bumped the version mid-flight
      // (409), the gate then re-renders with the new version's documents.
      await load();
    }
  }, [client, load, version]);

  // Only gate when consent is needed AND we have a numeric version to accept, so a
  // malformed/partial status can never deadlock the user on a gate they can't clear.
  const needsConsent = Boolean(status?.needsConsent) && version != null;
  return { isLoading, needsConsent, status, accept, refresh: load };
}

export type UseSignUpResult = { signUp: AuthOwlClient['signUp']['email'] };

export function useSignUp(): UseSignUpResult {
  const client = useAuthClient();
  return { signUp: client.signUp.email };
}

export type UseWaitlistResult = AuthOwlClient['waitlist'];

export function useWaitlist(): UseWaitlistResult {
  return useAuthClient().waitlist;
}

export type UseSignOutResult = { signOut: AuthOwlClient['signOut'] };

export function useSignOut(): UseSignOutResult {
  const client = useAuthClient();
  return { signOut: client.signOut };
}
