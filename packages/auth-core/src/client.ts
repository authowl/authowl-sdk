import { createAuthActionClient } from './native-client';
import { createPasskeyClient } from './passkey-client';
import { browserPasskeyCeremony } from './passkey-browser';
import type { ResolvedAuthConfig } from './config';
import { acceptConsent, getConsentStatus } from './consent';
import type { ConsentAcceptResult, ConsentStatus } from './consent';
import { createTokenClient } from './token';
import type { GetToken } from './token';
import type { AccountClient } from './account-client';
import type { OrganizationClient } from './organization-client';
import type { OrganizationMembership } from './organization-membership';
import { createAuthHttpClient } from './http-client';
import { createPrivacyClient, type PrivacyClient } from './privacy-client';

/**
 * The narrow, portable surface of the underlying auth client that this SDK
 * depends on and re-exports.
 *
 * We deliberately do NOT expose the engine's full inferred client type: it
 * references internal module paths (not portable across package boundaries -
 * TS2742) and is too large to serialize into a `.d.ts` (TS7056). Hand-writing
 * the surface we actually use keeps the published types small, stable, and
 * portable. Extend these interfaces as the SDK starts using more of the client
 * (e.g. two-factor / organization / passkey flows in later plans).
 */

/**
 * Minimal end-user shape the SDK surfaces (mirror of the underlying session
 * user). `name`/`image` are optional and nullable because the engine omits
 * them entirely for users that have none - this SDK only casts the response, it
 * does not normalize missing fields, so the type must not over-promise.
 */
export interface AuthUser {
  id: string;
  /** Null for phone-only users whose internal synthetic email is redacted. */
  email: string | null;
  /** Present for phone-authenticated users when the phone plugin is enabled. */
  phoneNumber?: string | null;
  /** Canonical project-scoped username, when username support is enabled. */
  username?: string | null;
  /** User-facing username casing retained alongside the canonical value. */
  displayUsername?: string | null;
  /** Structured profile names, when enabled by the project. */
  firstName?: string | null;
  lastName?: string | null;
  emailVerified: boolean;
  name?: string | null;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether the user has a verified second factor enrolled. Optional and
   * nullable because the engine only includes it once the twoFactor plugin is
   * active and the user has enrolled; treat a missing value as "not enrolled".
   */
  twoFactorEnabled?: boolean | null;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  /**
   * The active organization id, present once the organization plugin is in use
   * and the user has set an active org. Mirrors the JWT's `org_id` claim, so
   * consumers (e.g. the Convex adapter) can re-mint tokens when it changes.
   */
  activeOrganizationId?: string | null;
  /**
   * The member's active team within the active organization, or null.
   *
   * AuthOwl VALIDATES this before returning it: a stored pointer at a team in
   * another organization, at a deleted team, or at one the member has been removed
   * from comes back null, so it never needs re-checking here. The JWT carries the
   * same value as `team_id`, which is OMITTED rather than null when there is none -
   * the same convention `org_id` follows.
   */
  activeTeamId?: string | null;
  /**
   * The active organization membership - the member's canonical role and its
   * advisory permission claim (`org:sys_*` + custom `org:<feature>:<action>`
   * ids), populated by AuthOwl's `/get-session` shaping for the active org, else
   * `null`. This is the array the client `has()`/`hasPermission()` evaluate. It
   * is a UX affordance, NOT a security boundary: enforce authorization on the
   * server with the verified token (`@authowl/next`'s server `has()`).
   */
  membership?: OrganizationMembership | null;
  /**
   * B.5c: true while this session is held at required-MFA enrolment (the
   * project requires MFA and the user has no verified factor). The SDK and
   * auth() treat such a session as unauthenticated for app purposes; it is
   * cleared server-side when enrolment completes (CONTRACTS §5).
   */
  pendingMfaEnrollment?: boolean | null;
}

export interface AuthClientError {
  message?: string;
  status?: number;
  statusText?: string;
  code?: AuthOwlErrorCode | (string & {});
  /** Sanitized upstream correlation id, when the service supplied one. */
  requestId?: string;
  /** Present on VERSION_CONFLICT so the caller can re-read before retrying. */
  currentVersion?: number;
  /**
   * Seconds to wait before retrying, parsed from the body's `retryAfterSeconds`
   * field or the `Retry-After` / `X-Retry-After` header (delta-seconds form),
   * clamped to [1, 86400]. Present on rate-limit / lockout responses so callers
   * can render a live countdown; the drop-in forms surface it automatically.
   */
  retryAfterSeconds?: number;
}

/** Secret-free lifecycle metadata exposed before an auth request is sent. */
export type AuthRequestContext = Readonly<{
  method: 'GET' | 'POST' | 'PATCH';
  /** Endpoint path only. Query values, headers, cookies, and bodies are omitted. */
  path: string;
}>;

/** Secret-free lifecycle metadata exposed after a parsed response arrives. */
export type AuthResponseContext = Readonly<AuthRequestContext & {
  status: number;
  requestId?: string;
}>;

/** Secret-free lifecycle metadata exposed for transport or API failures. */
export type AuthErrorContext = Readonly<AuthRequestContext & {
  status: number;
  requestId?: string;
  failure:
    | 'api'
    | 'aborted'
    | 'timeout'
    | 'network'
    | 'response_too_large'
    | 'invalid_response';
}>;

/** Stable AuthOwl policy codes that callers can handle without matching messages. */
export type AuthOwlErrorCode =
  | 'MAU_BUDGET_REACHED'
  | 'BOT_CHALLENGE_FAILED'
  | 'VERSION_CONFLICT'
  | 'SESSION_NOT_FRESH'
  | 'ORGANIZATION_LAST_OWNER'
  | 'ORGANIZATION_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'INVITATION_NOT_FOUND'
  | 'EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION'
  | 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION'
  | 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION';

/** Framework-neutral reactive session snapshot. */
export interface SessionState {
  data: { user: AuthUser; session: AuthSession } | null;
  isPending: boolean;
  isRefetching: boolean;
  error: AuthClientError | null;
  /**
   * Re-fetch the current session from the server. `query.disableCookieCache`
   * forces a database read AND re-sets the session cookie - the repair path
   * for a stale cookie-cached `pendingMfaEnrollment` (CONTRACTS §5).
   */
  refetch: (options?: { query?: { disableCookieCache?: boolean } }) => void;
}

/**
 * External-store contract consumed by framework bindings such as
 * `@authowl/react`. Core never imports a UI framework.
 */
export interface SessionStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionState;
  /**
   * Re-read the session from the server, bypassing the cookie cache, and publish
   * the resulting snapshot to subscribers. Concurrent calls share one request.
   */
  refresh(): Promise<void>;
}

/** Standard `{ data, error }` envelope returned by the client's auth actions. */
export interface AuthActionResult<T = Record<string, unknown>> {
  data: T | null;
  error: AuthClientError | null;
}

/** Success payload of the email sign-in action. */
export interface EmailAuthData {
  user: AuthUser;
  /** Whether the server supplied a callback redirect. */
  redirect: boolean;
  url?: string;
}

/** Success payload of an in-place email one-time-code sign-in. */
export interface EmailOtpAuthData {
  user: AuthUser;
}

/**
 * Returned by a credential sign-in when the user has two-factor enrolled: NO
 * session is issued (`token`/`user` are absent) and the client must clear the 2FA
 * challenge (verify a TOTP or backup code) before it is signed in. This is the
 * discriminant `<SignIn/>` branches on; a headless consumer must handle it too.
 */
export interface TwoFactorRedirectData {
  twoFactorRedirect: true;
  /** Factors the server will accept, e.g. `["totp"]` / `["otp"]`. */
  twoFactorMethods?: string[];
}

/**
 * Success payload of the email sign-up action. `sessionCreated` is false when
 * the project requires email verification or has auto-sign-in disabled, so no
 * browser session was issued yet.
 */
export interface EmailSignUpData {
  sessionCreated: boolean;
  user: AuthUser;
}

/** Success payload of the social sign-in action. */
export type SocialAuthData =
  | { redirect: true; url: string }
  | { redirect: false; url: string }
  | { redirect: false; user: AuthUser };

/**
 * Success payload of the enterprise SSO sign-in action. OIDC/SAML SSO is always
 * a redirect flow (there is no in-place ID-token variant), so this is the
 * social payload's redirect half only: the client sends the browser to the
 * identity provider and the session is minted when the provider callback lands
 * on a fresh page.
 */
export interface SsoAuthData {
  /** Identity-provider authorization URL to send the browser to. */
  url: string;
  redirect: true;
}

/** Success payload of the sign-out action. */
export interface SignOutData {
  success: boolean;
}

export interface EmailSignInOptions {
  email: string;
  password: string;
  rememberMe?: boolean;
  callbackURL?: string;
}

export interface UsernameSignInOptions {
  username: string;
  password: string;
  rememberMe?: boolean;
  callbackURL?: string;
}

export interface EmailSignUpOptions {
  email: string;
  password: string;
  name: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  image?: string;
  callbackURL?: string;
  /**
   * The accepted legal-consent version (from `PublicConfig.legal.version`). Sent
   * in the sign-up body; when the project requires consent the server rejects a
   * sign-up whose value is missing or below the current version. <SignUp/> sets
   * this automatically when it renders the consent checkbox.
   */
  consentVersion?: number;
  /**
   * Exact published notice versions rendered by the sign-up surface, together
   * with purpose-specific choices. Current <SignUp/> builds this from public
   * config automatically; headless clients should echo the same projection.
   */
  privacyEvidence?: {
    locale: 'en' | 'ar';
    correlationId: string;
    noticeVersionIds: string[];
    consentDecisions: Array<{
      purposeCode: string;
      purposeVersionId: string;
      noticeVersionId: string;
      decision: 'granted' | 'refused';
      guardianRequired: boolean;
      guardianEvidenceId: string | null;
    }>;
  };
}

export interface WaitlistJoinOptions {
  email: string;
}

export interface WaitlistJoinData {
  accepted: true;
}

/** ID-token payload for non-redirect social sign-in (e.g. native Google/Apple). */
export interface SocialIdTokenOptions {
  token: string;
  nonce?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/** Options for the social sign-in action (mirror of the underlying client's). */
export interface SocialSignInOptions {
  provider: string;
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
  disableRedirect?: boolean;
  scopes?: string[];
  loginHint?: string;
  requestSignUp?: boolean;
  /** Sign in with a provider ID token instead of the redirect flow. */
  idToken?: SocialIdTokenOptions;
}

/**
 * Options for enterprise SSO sign-in - a SAFE SUBSET of the server's
 * `signInSSOBodySchema` (the client posts the body wholesale, so no client-only
 * fields leak onto the wire). It deliberately omits `scopes` and `providerType`,
 * which stay server-resolved: the app injects `scopes` from the stored connection
 * rather than trusting the caller, since user-supplied scopes would be a
 * scope-escalation surface. Supply at least one of `email` / `providerId` /
 * `domain` / `organizationSlug` so the server can resolve the connection; the
 * drop-in resolves the IdP from the user's email domain. `callbackURL` is
 * REQUIRED by the server - where the browser lands after the IdP round-trip.
 */
export interface SsoSignInOptions {
  /** The user's email; its domain identifies the SSO connection to use. */
  email?: string;
  /** Resolve the connection by its provider id directly (instead of by email domain). */
  providerId?: string;
  /** Resolve the connection by verified email domain directly. */
  domain?: string;
  /** Resolve the connection by the organization slug it is bound to. */
  organizationSlug?: string;
  /** Where the browser lands after the IdP round-trip. Required by the server. */
  callbackURL: string;
  /** Where to send the browser if the SSO flow fails. */
  errorCallbackURL?: string;
  /** Where to land when SSO provisions a new account (if the connection allows it). */
  newUserCallbackURL?: string;
  /** `login_hint` forwarded to the identity provider when it supports one. */
  loginHint?: string;
  /** Explicitly request sign-up when the connection has implicit sign-up disabled. */
  requestSignUp?: boolean;
}

/** Options for passwordless magic-link sign-in (a link is emailed to the user). */
export interface MagicLinkSignInOptions {
  email: string;
  /** Where to land after the emailed link is followed. */
  callbackURL?: string;
  /** Where to send the browser if the link is invalid or expired. */
  errorCallbackURL?: string;
  /** Where to land when the link creates a new account (if the server allows it). */
  newUserCallbackURL?: string;
}

/**
 * Success payload of the magic-link request. No session is issued here - the
 * link is emailed and the session is created when the user follows it.
 */
export interface MagicLinkData {
  status: boolean;
}

/** Purpose of an email one-time code. Sign-in is the SDK's passwordless flow. */
export type EmailOtpType = 'sign-in' | 'email-verification' | 'forget-password';

/** Options to request an email one-time code. */
export interface SendVerificationOtpOptions {
  email: string;
  type: EmailOtpType;
}

/** Success payload of the send-OTP request (no session yet). */
export interface SendOtpData {
  success: boolean;
}

/** Options to complete email-OTP sign-in with the emailed code. */
export interface EmailOtpSignInOptions {
  email: string;
  otp: string;
}

/** Options to complete required email ownership verification with a code. */
export interface VerifyEmailOtpOptions {
  email: string;
  otp: string;
}

export interface VerifyEmailOtpData {
  status: boolean;
  user: AuthUser;
}

export type PhoneOtpChallengeData =
  | Readonly<{ kind: 'authowl_turnstile' }>
  | Readonly<{
      kind: 'akedly_shield_v1_2';
      connectionId: string;
      challenge: string;
      difficulty: number;
      challengeToken: string;
      challengeRequired: boolean;
      turnstile: Readonly<{ required: boolean; siteKey: string | null }>;
    }>;

export type AkedlyShieldStartProof = Readonly<{
  connectionId: string;
  challengeToken?: string;
  nonce?: number;
  turnstileToken?: string;
}>;

/** Start an Egyptian phone OTP sign-in. Reuse idempotencyKey after an ambiguous retry. */
export type PhoneOtpStartOptions =
  | Readonly<{
      phoneNumber: string;
      turnstileToken: string;
      akedlyShield?: never;
      idempotencyKey?: string;
    }>
  | Readonly<{
      phoneNumber: string;
      turnstileToken?: never;
      akedlyShield: AkedlyShieldStartProof;
      idempotencyKey?: string;
    }>;

export interface PhoneOtpStartData {
  status: 'pending';
}

/** Verify the SMS code and create or resume the phone user's session. */
export interface PhoneOtpVerifyOptions {
  phoneNumber: string;
  code: string;
  consentVersion?: number;
}

export interface PhoneAuthUser {
  id: string;
  name?: string | null;
  phoneNumber: string;
  phoneNumberVerified: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PhoneOtpVerifyData {
  status: true;
  sessionCreated: true;
  user: PhoneAuthUser;
}

/** Options to request a password-reset email. */
export interface RequestPasswordResetOptions {
  email: string;
  /**
   * Where the emailed reset link lands - the page hosting your reset form. The
   * link validates the token server-side then redirects here with `?token=`. Its
   * origin must be one of the project's allowed origins.
   */
  redirectTo?: string;
}

/** Options to set a new password with a reset token. */
export interface ResetPasswordOptions {
  newPassword: string;
  /** The token from the `?token=` query param the reset link redirected to. */
  token: string;
}

/** Success payload of the request-reset / reset-password actions (no session). */
export interface PasswordResetData {
  status: boolean;
}

/** Options to (re)send the email-verification link. */
export interface SendVerificationEmailOptions {
  email: string;
  /**
   * Where the verification link lands after it confirms the address - the page
   * hosting <VerifyEmail/>. Its origin must be one of the project's allowed
   * origins. Defaults to "/" server-side when omitted.
   */
  callbackURL?: string;
}

/** Success payload of the send-verification-email action (no session). */
export interface VerificationEmailData {
  status: boolean;
}

/** Options for passkey (WebAuthn) sign-in. */
export interface PasskeySignInOptions {
  /**
   * Use conditional mediation (browser autofill) instead of a modal. The caller
   * must have an input with an `autocomplete` value containing `webauthn` on the
   * page for the browser to surface passkeys; the promise resolves when the user
   * picks one. Defaults to a modal prompt.
   */
  autoFill?: boolean;
}

/** Success payload of passkey sign-in. */
export interface PasskeyAuthData {
  session: AuthSession;
  user: AuthUser;
}

/**
 * A registered passkey credential projected from the engine's row. Only `id`,
 * `name`, `deviceType`, and `createdAt` are needed to render a management list;
 * the rest are surfaced for completeness.
 */
export interface AuthPasskey {
  id: string;
  name?: string | null;
  publicKey: string;
  userId: string;
  credentialID: string;
  counter: number;
  /** WebAuthn credential device type. */
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  transports?: string | null;
  createdAt: Date;
  aaguid?: string | null;
}

/** Options to register a new passkey for the signed-in user. */
export interface AddPasskeyOptions {
  /** Human label shown in the passkey list (defaults to a browser-chosen name). */
  name?: string;
  /** Prefer a platform (device) or cross-platform (security key) authenticator. */
  authenticatorAttachment?: 'platform' | 'cross-platform';
}

/** Options to rename an existing passkey. */
export interface UpdatePasskeyOptions {
  id: string;
  name: string;
}

/** Options to remove an existing passkey. */
export interface DeletePasskeyOptions {
  id: string;
}

/** Success payload of the delete-passkey action. */
export interface DeletePasskeyData {
  status: true;
}

/**
 * Success payload of the update-passkey action. The engine returns the updated
 * row wrapped as `{ passkey }` (not a bare passkey), so consumers read
 * `res.data.passkey`.
 */
export interface UpdatePasskeyData {
  passkey: AuthPasskey;
}

/** Options to begin TOTP two-factor enrolment (password-gated). */
export interface EnableTwoFactorOptions {
  password: string;
  /** Overrides the issuer label shown in the authenticator app (defaults server-side). */
  issuer?: string;
}

/**
 * Enrolment payload: the `otpauth://` URI to render as a QR (and its embedded
 * secret for manual entry) plus the one-time backup codes, shown ONCE. The factor
 * is not active until a live TOTP is verified.
 */
export interface TwoFactorEnableData {
  totpURI: string;
  backupCodes: string[];
}

/** Options to disable two-factor for the signed-in user (password-gated). */
export interface DisableTwoFactorOptions {
  password: string;
}

/** Options to (re)generate the backup codes (password-gated), invalidating the old set. */
export interface GenerateBackupCodesOptions {
  password: string;
}

/** Payload carrying a freshly-generated set of backup codes (shown once). */
export interface TwoFactorBackupCodesData {
  backupCodes: string[];
}

/** Verify a TOTP code - to activate a new factor, or to clear a sign-in challenge. */
export interface VerifyTotpOptions {
  code: string;
  /** Skip the challenge on this device for ~30 days (sets a trusted-device cookie). */
  trustDevice?: boolean;
}

/** Verify a single-use backup code to clear a sign-in challenge. */
export interface VerifyBackupCodeOptions {
  code: string;
  trustDevice?: boolean;
}

/** Request the emailed fallback code for a pending 2FA challenge (B.5d). */
export interface SendTwoFactorOtpOptions {
  /**
   * Inert here - the engine's send endpoint accepts this field but ignores it;
   * device trust is granted only when you verify. Pass `trustDevice` to
   * `verifyOtp` instead.
   */
  trustDevice?: boolean;
}

/** Success payload of the fallback-code send (the code goes to the user's email). */
export interface SendTwoFactorOtpData {
  status: boolean;
}

/** Verify the emailed fallback code to clear a sign-in challenge. */
export interface VerifyTwoFactorOtpOptions {
  code: string;
  trustDevice?: boolean;
}

/**
 * Result of clearing a 2FA challenge. The browser session is issued only via
 * Set-Cookie; its durable token is never projected into JavaScript state.
 */
export interface TwoFactorVerifyData {
  status: true;
}

/** Success payload of enable/disable (the engine returns a bare status flag). */
export interface TwoFactorStatusData {
  status: boolean;
}

/**
 * Per-call fetch options every action accepts as an optional second argument -
 * lifecycle callbacks and extra headers, matching the underlying client. The
 * callback context is intentionally `unknown`: narrow it at the call site.
 */
export interface ActionFetchOptions {
  headers?: Record<string, string>;
  /**
   * Single-use Cloudflare Turnstile token for a protected public-auth action.
   * The SDK transports it in `x-authowl-turnstile-token`; it is never serialized
   * into the action JSON body. Obtain the token with the exact action name
   * documented for the endpoint.
   */
  authChallengeToken?: string;
  signal?: AbortSignal;
  /**
   * Retry safe GET network failures and 5xx responses, capped at three retries.
   * POST and PATCH actions are never replayed by the generic client.
   */
  retry?: number;
  onRequest?: (context: AuthRequestContext) => unknown;
  onResponse?: (context: AuthResponseContext) => unknown;
  onSuccess?: (context: AuthResponseContext) => unknown;
  onError?: (context: AuthErrorContext) => unknown;
}

export interface AuthOwlClient {
  /** Framework-neutral session state. React consumers use `@authowl/react`'s `useSession()`. */
  sessionStore: SessionStore;
  /** Signed-in account profile, credential, session, provider, and deletion actions. */
  account: AccountClient;
  /** Signed-in organization, membership, role, and invitation actions. */
  organization: OrganizationClient;
  /** Signed-in privacy preferences and data-subject-rights actions. */
  privacy: PrivacyClient;
  signIn: {
    /**
     * Email + password sign-in. For a two-factor-enrolled user the result is a
     * {@link TwoFactorRedirectData} (no session) - branch on `twoFactorRedirect`
     * before treating the sign-in as complete.
     */
    email(
      params: EmailSignInOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<EmailAuthData | TwoFactorRedirectData>>;
    /** Username + password sign-in, when enabled by project policy. */
    username(
      params: UsernameSignInOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<EmailAuthData | TwoFactorRedirectData>>;
    social(
      params: SocialSignInOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<SocialAuthData>>;
    /**
     * Enterprise SSO (OIDC/SAML): resolve the tenant's identity provider (by the
     * email domain, or an explicit `providerId`/`domain`/`organizationSlug`) and
     * redirect the browser to it. Always a redirect flow - no session is issued
     * here; it is minted when the provider callback lands on a fresh page.
     */
    sso(
      params: SsoSignInOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<SsoAuthData>>;
    /** Passwordless: email a one-time sign-in link. */
    magicLink(
      params: MagicLinkSignInOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<MagicLinkData>>;
    /** Passwordless: complete sign-in with an emailed one-time code. */
    emailOtp(
      params: EmailOtpSignInOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<EmailOtpAuthData>>;
    /** Passwordless: sign in with a registered passkey (WebAuthn). */
    passkey(
      params?: PasskeySignInOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<PasskeyAuthData>>;
  };
  signUp: {
    email(
      params: EmailSignUpOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<EmailSignUpData>>;
  };
  /** Public email-only waitlist enrollment for this environment. */
  waitlist: {
    join(
      params: WaitlistJoinOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<WaitlistJoinData>>;
  };
  /** Email one-time-code actions (request side; completion is `signIn.emailOtp`). */
  emailOtp: {
    sendVerificationOtp(
      params: SendVerificationOtpOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<SendOtpData>>;
    /** Complete a required email verification ceremony with an emailed code. */
    verifyEmail(
      params: VerifyEmailOtpOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<VerifyEmailOtpData>>;
  };
  /** Managed Egyptian phone OTP. Start sends the code; verify establishes the session. */
  phoneOtp: {
    /** Discover the server-selected anti-abuse ceremony without exposing provider credentials. */
    prepare(
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<PhoneOtpChallengeData>>;
    start(
      params: PhoneOtpStartOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<PhoneOtpStartData>>;
    verify(
      params: PhoneOtpVerifyOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<PhoneOtpVerifyData>>;
  };
  /** Email a password-reset link to the user (no session issued). */
  requestPasswordReset(
    params: RequestPasswordResetOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<PasswordResetData>>;
  /** Set a new password using the token from a reset link. */
  resetPassword(
    params: ResetPasswordOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<PasswordResetData>>;
  /** (Re)send the email-verification link. No session required. */
  sendVerificationEmail(
    params: SendVerificationEmailOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<VerificationEmailData>>;
  /** Passkey management for the signed-in user. */
  passkey: {
    addPasskey(
      params?: AddPasskeyOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<AuthPasskey>>;
    /**
     * List the signed-in user's passkeys. Takes no argument: this is a GET
     * endpoint and the underlying client would send a first argument as a POST
     * body (flipping the method), so fetch options are intentionally not exposed.
     */
    listUserPasskeys(): Promise<AuthActionResult<AuthPasskey[]>>;
    updatePasskey(
      params: UpdatePasskeyOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<UpdatePasskeyData>>;
    deletePasskey(
      params: DeletePasskeyOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<DeletePasskeyData>>;
  };
  /**
   * TOTP two-factor for the signed-in user (enrolment) and the sign-in challenge
   * (verify). Enrolment is password-gated; a factor only becomes active once a live
   * TOTP is verified. Drives {@link useMFA}/<MFAEnrollment/>/<MFAChallenge/>.
   */
  twoFactor: {
    /** Begin enrolment: returns the TOTP URI + one-time backup codes (factor stays inactive until verified). */
    enable(
      params: EnableTwoFactorOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<TwoFactorEnableData>>;
    /** Turn two-factor off for the user (password-gated). */
    disable(
      params: DisableTwoFactorOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<TwoFactorStatusData>>;
    /** Verify a TOTP code: activates a pending factor, or clears a sign-in challenge. */
    verifyTotp(
      params: VerifyTotpOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<TwoFactorVerifyData>>;
    /** Clear a sign-in challenge with a single-use backup code. */
    verifyBackupCode(
      params: VerifyBackupCodeOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<TwoFactorVerifyData>>;
    /**
     * Email a fallback second-factor code for the pending challenge (B.5d -
     * the lost-authenticator path; only live during a challenge).
     */
    sendOtp(
      params?: SendTwoFactorOtpOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<SendTwoFactorOtpData>>;
    /** Clear a sign-in challenge with the emailed fallback code. */
    verifyOtp(
      params: VerifyTwoFactorOtpOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<TwoFactorVerifyData>>;
    /** Regenerate the backup codes (password-gated), invalidating the previous set. */
    generateBackupCodes(
      params: GenerateBackupCodesOptions,
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<TwoFactorBackupCodesData>>;
  };
  signOut(fetchOptions?: ActionFetchOptions): Promise<AuthActionResult<SignOutData>>;
  /**
   * One-shot session fetch (the reactive form is `sessionStore`). `query.
   * disableCookieCache: true` forces a database read - required before acting
   * on `pendingMfaEnrollment` (its cookie-cached value can be stale-true for
   * up to 5 minutes; CONTRACTS §5).
   */
  getSession(options?: {
    query?: { disableCookieCache?: boolean };
  }): Promise<AuthActionResult<{ session: AuthSession; user: AuthUser } | null>>;
  /**
   * Mint a short-lived JWT for third-party backends (Convex/Supabase/Hasura;
   * requires the project's JWT issuer to be enabled). Cached in memory and
   * refreshed ahead of expiry. `{ template: 'convex' }` selects a named
   * environment template and `{ forceRefresh: true }` bypasses only that
   * template's cache entry.
   * Resolves `null` when nobody is signed in; throws on other failures.
   */
  getToken: GetToken;
  /**
   * Legal-consent status for the signed-in user. Drives the re-consent gate: when
   * the operator bumps the terms version, `needsConsent` flips true until the user
   * accepts. `{ required: false }` when the project has no gate or nobody's signed in.
   */
  getConsentStatus(): Promise<ConsentStatus>;
  /**
   * Record the signed-in user's acceptance of the terms `version` they were shown
   * (echo `getConsentStatus().version`). A 409 (the operator bumped the version
   * meanwhile) surfaces as a thrown error; re-fetch the status and re-prompt.
   */
  acceptConsent(version: number): Promise<ConsentAcceptResult>;
}

/**
 * Build the underlying auth client pointed at the project's per-project endpoint.
 * Every request is sent with credentials so the HttpOnly session cookie flows
 * cross-origin (server must set SameSite=None + Secure for this to work).
 * The publishable key travels in X-Publishable-Key on every request.
 */
export function createAuthOwlClient(config: ResolvedAuthConfig): AuthOwlClient {
  // Consent and backend-token methods use AuthOwl sibling endpoints rather than
  // the project auth action prefix. Keep them in focused services and compose
  // them onto the native action client here.
  const tokenClient = createTokenClient(config);
  const client = createAuthActionClient(
    config,
    tokenClient.clear,
    (http, sessionChanged) =>
      createPasskeyClient(http, sessionChanged, browserPasskeyCeremony),
  );
  const waitlistHttp = createAuthHttpClient(
    config,
    `${new URL(config.apiUrl).origin}/api/projects/${config.decoded.projectId}`,
  );
  const privacyClient = createPrivacyClient(waitlistHttp);
  // Backend-JWT cache records carry identity and template claim fields. EVERY
  // action that can mutate those claims, establish or replace identity, revoke
  // a session, or drop the account clears all entries before dispatch. Redirect
  // flows (social redirect, the emailed magic link) land on a fresh page whose
  // new client starts with an empty cache. Clearing on a failed attempt is
  // harmless (one extra re-mint).
  const clearThen =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      tokenClient.clear();
      return fn(...args);
    };
  const ownMethods = {
    getConsentStatus: () => getConsentStatus(config),
    acceptConsent: (version: number) => acceptConsent(config, version),
    getToken: tokenClient.getToken,
    privacy: privacyClient,
    waitlist: {
      join: (params: WaitlistJoinOptions, fetchOptions?: ActionFetchOptions) =>
        waitlistHttp.request<WaitlistJoinData>('/waitlist', {
          method: 'POST',
          body: params,
          fetchOptions,
          credentials: 'omit',
        }),
    },
    account: {
      ...client.account,
      // These mutations can change current-session or JWT-template claims
      // before a malformed response is decoded. Clear before dispatch.
      updateUnsafeMetadata: clearThen(client.account.updateUnsafeMetadata),
      updateProfile: clearThen(client.account.updateProfile),
      changeEmail: clearThen(client.account.changeEmail),
      changePassword: clearThen(client.account.changePassword),
      revokeSession: clearThen(client.account.revokeSession),
      delete: clearThen(client.account.delete),
    },
    signIn: {
      email: clearThen(client.signIn.email),
      username: clearThen(client.signIn.username),
      social: clearThen(client.signIn.social), // the idToken variant mints in place
      sso: client.signIn.sso, // redirect-only; the IdP callback mints on a fresh page
      magicLink: client.signIn.magicLink, // request-only; the emailed link mints via redirect
      emailOtp: clearThen(client.signIn.emailOtp),
      passkey: clearThen(client.signIn.passkey),
    },
    signUp: {
      email: clearThen(client.signUp.email),
    },
    emailOtp: {
      ...client.emailOtp,
      verifyEmail: clearThen(client.emailOtp.verifyEmail),
    },
    twoFactor: {
      enable: client.twoFactor.enable,
      // Disable rotates the browser session while removing the factor.
      disable: clearThen(client.twoFactor.disable),
      // Clearing a 2FA challenge completes a sign-in (mints the session).
      verifyTotp: clearThen(client.twoFactor.verifyTotp),
      verifyBackupCode: clearThen(client.twoFactor.verifyBackupCode),
      sendOtp: client.twoFactor.sendOtp, // request-only; the verify below mints
      verifyOtp: clearThen(client.twoFactor.verifyOtp),
      generateBackupCodes: client.twoFactor.generateBackupCodes,
    },
    phoneOtp: {
      prepare: client.phoneOtp.prepare,
      start: client.phoneOtp.start,
      verify: clearThen(client.phoneOtp.verify),
    },
    signOut: clearThen(client.signOut),
    // `satisfies` keeps every wrapper signature pinned to the published interface.
  } satisfies Pick<
    AuthOwlClient,
    | 'getConsentStatus'
    | 'acceptConsent'
    | 'getToken'
    | 'privacy'
    | 'waitlist'
    | 'account'
    | 'signIn'
    | 'signUp'
    | 'emailOtp'
    | 'twoFactor'
    | 'phoneOtp'
    | 'signOut'
  >;
  return { ...client, ...ownMethods } satisfies AuthOwlClient;
}
