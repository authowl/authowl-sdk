import type { ResolvedAuthConfig } from './config';
import { requestPublishableJson, requireOk } from './http';
import { decodeJsonObject } from './response-schema';

export type EnvironmentType = 'development' | 'production';

/**
 * The public, publishable-key-safe project config the SDK renders its sign-in
 * UI from (server contract CONTRACTS §2, `GET /api/projects/:id/public-config`).
 * Nothing here is secret. Method slugs are canonical snake_case.
 */
/**
 * A project's configured bot challenge.
 *
 * `provider` is deliberately a plain string rather than a union of the ones this
 * SDK can render. A project may be switched to a provider that predates the
 * copy of the SDK an application is running, and the difference between
 * "no challenge configured" and "a challenge this build cannot render" is the
 * difference between signing in and a silent 403 the user cannot act on. Keeping
 * the slug lets the renderer say which provider it does not know.
 */
export interface CaptchaConfig {
  provider: string;
  siteKey: string;
}

export type PublicConfig = {
  /** Stable workspace product container shared by its environments. */
  applicationId: string;
  /** Stable tenant id for the exact environment selected by the publishable key. */
  environmentId: string;
  /** Environment class that determines key prefixes and billing treatment. */
  environmentType: EnvironmentType;
  /**
   * Authentication endpoint used by this SDK instance. Hosted portals and
   * custom domains keep this same-origin even when the stable JWT issuer uses
   * the platform's canonical origin.
   */
  authBaseUrl: string;
  /**
   * Public acquisition mode. Optional only for rolling compatibility with
   * servers released before waitlist support.
   */
  signUp?: {
    mode: 'open' | 'restricted' | 'allowlist' | 'waitlist';
  };
  /**
   * Identity and credential lifecycle policy. Optional only for rolling
   * compatibility with AuthOwl servers released before plan 35.
   */
  authentication?: {
    email: {
      signUp: boolean;
      signIn: Array<'password' | 'magic_link' | 'email_otp'>;
    };
    phone: { signUp: boolean; signIn: boolean };
    password: {
      signUp: boolean;
      add: boolean;
      /** Server-owned password length policy. Optional for rolling compatibility. */
      minLength?: number;
      maxLength?: number;
    };
    passkey: {
      signIn: boolean;
      add: boolean;
      /**
       * The domain this environment binds passkeys to. Absent or null means the
       * server derives it from the auth host, which is what every server before
       * this field did - so treating both the same keeps a new SDK correct
       * against an older server.
       */
      relyingPartyId?: string | null;
    };
    username: { collectOnSignUp: boolean; signIn: boolean };
  };
  /** Email ownership ceremony selected by the project. */
  emailVerification?: {
    required: boolean;
    method: 'link' | 'code';
  };
  /** End-user profile fields and self-service permissions. */
  userModel?: {
    requireEmail: boolean;
    firstLastName: boolean;
    emailChange: boolean;
    accountDeletion: boolean;
  };
  /**
   * MFA presentation contract. Backup codes follow TOTP and are not an
   * independently configurable authentication method.
   */
  mfa?: {
    totp: boolean;
    required: boolean;
    backupCodes: boolean;
    /** Whether an emailed code may recover a TOTP challenge. Defaults to true for older servers. */
    emailOtpFallback?: boolean;
    /** Whether a successful challenge may remember this browser. Defaults to true for older servers. */
    trustDevice?: boolean;
  };
  branding: {
    appName?: string;
    logoUrl?: string;
    /** Whether the application name is visible beside the logo. */
    showAppName?: boolean;
    /** Alignment of the brand identity within managed component headers. */
    alignment?: 'left' | 'center' | 'right';
    primaryColor?: string;
    theme?: 'light' | 'dark' | 'system';
  };
  /** Canonical method slugs, e.g. "password", "magic_link", "passkey". */
  enabledMethods: string[];
  /** Configured social provider ids, e.g. "google". */
  socialProviders: string[];
  /**
   * Public OAuth client ids keyed by provider. Optional for rolling compatibility
   * with servers released before Google One Tap support.
   */
  socialProviderClientIds?: Record<string, string>;
  /**
   * When true, an email/password sign-up does not create a session - the user
   * must confirm their address first. <SignUp/> shows a "check your email" state
   * instead of redirecting. Always false unless password sign-up is enabled.
   */
  requireEmailVerification: boolean;
  /**
   * Legal consent gate. When `required`, <SignUp/> shows an acceptance checkbox
   * linking `termsUrl`/`privacyUrl` and blocks sign-up until it's checked, echoing
   * `version` back so the server records and enforces it. `required` is true only
   * when the project both requires consent and has a document URL to link.
   */
  legal: {
    termsUrl?: string;
    privacyUrl?: string;
    version: number;
    required: boolean;
  };
  /** Published, bilingual privacy notices and optional consent purposes. */
  privacy?: {
    notices: Array<{
      noticeId: string;
      noticeVersionId: string;
      code: string;
      version: number;
      title: { en: string; ar: string };
      body: { en: string; ar: string };
      digest: { en: string; ar: string };
      activityCodes: string[];
      purposeCodes: string[];
      effectiveFrom: string;
    }>;
    /**
     * Which data rights this project can actually accept.
     *
     * ABSENT MEANS UNKNOWN, NOT NONE. A server released before this field
     * simply does not send it, and treating that as "offer nothing" would
     * blank the rights section for every project on an older deployment. The
     * server stays the enforcement boundary either way.
     * Unknown future wire values may be present and are ignored by consumers
     * that do not yet know how to render them.
     */
    availableRightTypes?: string[];
    consentPurposes: Array<{
      purposeId: string;
      purposeVersionId: string;
      code: string;
      version: number;
      title: { en: string; ar: string };
      description: { en: string; ar: string };
      digest: { en: string; ar: string };
      activityCodes: string[];
      dataCategories: string[];
    }>;
  };
  /**
   * Whether the project lets signed-in users enrol a second factor (TOTP). A
   * capability flag, not a sign-in method (so it's absent from `enabledMethods`):
   * gate an "enable two-factor" affordance / <MFAEnrollment/> on it. The sign-in
   * 2FA challenge is handled by <SignIn/> regardless of this flag.
   */
  twoFactor: boolean;
  /** Whether enrolled MFA is mandatory rather than optional for this project. */
  mfaRequired: boolean;
  /** Whether signed-in users may delete their own account. */
  accountDeletion: boolean;
  /** Whether organization routes and components are available for this project. */
  organizations: boolean;
  /**
   * Whether inbound enterprise SSO is enabled for this project. SSO IS a sign-in
   * method, so when true the server also pushes `'sso'` into `enabledMethods`;
   * this flag mirrors the server capability (matching the `twoFactor`
   * convention). <SignIn/> gates the SSO affordance on `enabledMethods`, not on
   * this flag, so the two never drift.
   */
  sso: boolean;
  /**
   * JWT issuer (server contract CONTRACTS §8). Non-null only when the project's
   * issuer toggle is on: exactly what a third-party verifier needs (Convex
   * `auth.config.ts` = `{ type: "customJwt", issuer, jwks: jwksUrl,
   * applicationID: aud, algorithm: "ES256" }`). The issuer remains stable when
   * `authBaseUrl` follows a hosted or custom account-portal origin.
   */
  jwtIssuer: { issuer: string; jwksUrl: string; aud: string } | null;
  /**
   * The bot challenge a project has configured, provider-agnostic.
   *
   * Prefer this over the two Turnstile fields below, which predate provider
   * choice and remain populated whenever the provider IS Turnstile.
   */
  captcha: CaptchaConfig | null;
  /** Public Cloudflare Turnstile site key for the phone OTP challenge. */
  turnstileSiteKey: string | null;
  /** Public Cloudflare Turnstile site key for protected sign-up/sign-in actions. */
  authTurnstileSiteKey: string | null;
  locale: string;
  badge: boolean;
  configVersion: number;
};

/**
 * Fetch a project's public config. Publishable-key gated server-side; sent
 * without cookies (the payload is public, so no session is needed). Throws on a
 * non-2xx response so the caller can distinguish "config unavailable" from a
 * project that simply has a method disabled.
 */
export async function getPublicConfig(config: ResolvedAuthConfig): Promise<PublicConfig> {
  const url = `${config.apiUrl}/api/projects/${config.decoded.projectId}/public-config`;

  return requireOk(
    await requestPublishableJson(config, url, {
      init: { method: 'GET', credentials: 'omit' },
      maxResponseBytes: 256 * 1024,
      decode: (value) => decodePublicConfig(value, config),
    }),
    'public-config',
  );
}

function decodePublicConfig(
  value: unknown,
  config: ResolvedAuthConfig,
): PublicConfig {
  const row = decodeJsonObject(value);
  const environmentId = row.environmentId;
  const environmentType = row.environmentType;
  const expectedAuthBaseUrl =
    `${config.apiUrl}/api/projects/${config.decoded.projectId}/auth`;
  if (
    typeof row.applicationId !== 'string' ||
    !isUuid(row.applicationId) ||
    environmentId !== config.decoded.projectId ||
    (environmentType !== 'development' && environmentType !== 'production') ||
    row.authBaseUrl !== expectedAuthBaseUrl
  ) {
    throw invalidPublicConfig();
  }
  const branding = asObject(row.branding);
  const legal = asObject(row.legal);
  if (
    !isStringArray(row.enabledMethods, 64)
    || !isStringArray(row.socialProviders, 64)
    || !optionalStrings(branding, ['appName', 'logoUrl', 'primaryColor'])
    || (branding.showAppName !== undefined && typeof branding.showAppName !== 'boolean')
    || (
      branding.alignment !== undefined
      && branding.alignment !== 'left'
      && branding.alignment !== 'center'
      && branding.alignment !== 'right'
    )
    || (
      branding.theme !== undefined
      && branding.theme !== 'light'
      && branding.theme !== 'dark'
      && branding.theme !== 'system'
    )
    || !optionalStrings(legal, ['termsUrl', 'privacyUrl'])
    || !Number.isSafeInteger(legal.version)
    || (legal.version as number) < 0
    || typeof legal.required !== 'boolean'
  ) {
    throw invalidPublicConfig();
  }
  if (row.socialProviderClientIds !== undefined) {
    const ids = asObject(row.socialProviderClientIds);
    if (
      Object.keys(ids).length > 64
      || Object.values(ids).some((entry) => typeof entry !== 'string' || entry.length > 2048)
    ) {
      throw invalidPublicConfig();
    }
  }
  if (!hasBooleans(row, [
    'requireEmailVerification',
    'twoFactor',
    'mfaRequired',
    'accountDeletion',
    'organizations',
    'sso',
    'badge',
  ])) throw invalidPublicConfig();
  if (
    !isNullableString(row.turnstileSiteKey)
    || !isNullableString(row.authTurnstileSiteKey)
    || typeof row.locale !== 'string'
    || row.locale.length === 0
    || row.locale.length > 64
    || !Number.isSafeInteger(row.configVersion)
    || (row.configVersion as number) < 0
  ) {
    throw invalidPublicConfig();
  }
  if (row.jwtIssuer !== null) {
    const jwt = asObject(row.jwtIssuer);
    const issuer = new URL(jwt.issuer as string);
    const expectedIssuer =
      `${issuer.origin}/api/projects/${config.decoded.projectId}/auth`;
    if (
      jwt.issuer !== expectedIssuer
      || jwt.jwksUrl !== `${expectedIssuer}/jwks`
      || jwt.aud !== config.decoded.projectId
      || (issuer.protocol !== 'https:' && issuer.origin !== config.apiUrl)
    ) throw invalidPublicConfig();
  }
  if (row.signUp !== undefined) {
    const mode = asObject(row.signUp).mode;
    if (
      typeof mode !== 'string'
      || !['open', 'restricted', 'allowlist', 'waitlist'].includes(mode)
    ) {
      throw invalidPublicConfig();
    }
  }
  if (row.authentication !== undefined) assertAuthentication(row.authentication);
  if (row.privacy !== undefined) assertPrivacyConfig(row.privacy);
  if (row.emailVerification !== undefined) {
    const email = asObject(row.emailVerification);
    if (
      !hasBooleans(email, ['required'])
      || (email.method !== 'link' && email.method !== 'code')
    ) throw invalidPublicConfig();
  }
  if (
    row.userModel !== undefined
    && !hasBooleans(asObject(row.userModel), [
      'requireEmail',
      'firstLastName',
      'emailChange',
      'accountDeletion',
    ])
  ) throw invalidPublicConfig();
  if (row.mfa !== undefined) {
    const mfa = asObject(row.mfa);
    if (
      !hasBooleans(mfa, ['totp', 'required', 'backupCodes'])
      || (mfa.emailOtpFallback !== undefined && typeof mfa.emailOtpFallback !== 'boolean')
      || (mfa.trustDevice !== undefined && typeof mfa.trustDevice !== 'boolean')
      || ((mfa.required === true || mfa.backupCodes === true) && mfa.totp !== true)
    ) throw invalidPublicConfig();
  }
  // Normalise the challenge to ONE shape before callers see it.
  //
  // A server older than provider choice sends no `captcha` at all, only the
  // Turnstile site key. Deriving the generic shape here means every caller reads
  // `config.captcha` and nothing downstream has to remember the legacy field
  // exists - which is what keeps the eventual provider switch from becoming a
  // change in five components.
  if (row.captcha === undefined || row.captcha === null) {
    row.captcha = typeof row.authTurnstileSiteKey === 'string'
      && row.authTurnstileSiteKey.length > 0
      ? { provider: 'turnstile', siteKey: row.authTurnstileSiteKey }
      : null;
  } else {
    const captcha = asObject(row.captcha);
    if (
      typeof captcha.provider !== 'string'
      || captcha.provider.length === 0
      || captcha.provider.length > 64
      || typeof captcha.siteKey !== 'string'
      || captcha.siteKey.length === 0
      || captcha.siteKey.length > 512
    ) {
      throw invalidPublicConfig();
    }
    row.captcha = { provider: captcha.provider, siteKey: captcha.siteKey };
  }

  // Advisory, and normalised rather than validated - see `normalizeRightTypes`.
  if (row.privacy !== undefined && row.privacy !== null) {
    const privacy = asObject(row.privacy);
    if (privacy.availableRightTypes !== undefined) {
      privacy.availableRightTypes = normalizeRightTypes(privacy.availableRightTypes);
    }
  }

  return row as unknown as PublicConfig;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function invalidPublicConfig(): Error {
  return new TypeError('public-config returned an invalid response');
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidPublicConfig();
  }
  return value as Record<string, unknown>;
}

function isNullableString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length <= 4096);
}

function assertAuthentication(value: unknown): void {
  const row = asObject(value);
  const email = asObject(row.email);
  const password = asObject(row.password);
  const hasPasswordLimits = password.minLength !== undefined || password.maxLength !== undefined;
  if (
    !hasBooleans(email, ['signUp'])
    || !isStringArray(email.signIn, 3)
    || (email.signIn as string[]).some(
      (method) => method !== 'password' && method !== 'magic_link' && method !== 'email_otp',
    )
    || !hasBooleans(asObject(row.phone), ['signUp', 'signIn'])
    || !hasBooleans(password, ['signUp', 'add'])
    || (hasPasswordLimits && (
      !Number.isSafeInteger(password.minLength)
      || !Number.isSafeInteger(password.maxLength)
      || (password.minLength as number) < 1
      || (password.maxLength as number) > 4096
      || (password.minLength as number) > (password.maxLength as number)
    ))
    || !hasBooleans(asObject(row.passkey), ['signIn', 'add'])
    // Optional on purpose: an older server sends no such field, and rejecting
    // its config would turn a forward-compatible addition into an outage.
    || !isOptionalNullableString(asObject(row.passkey).relyingPartyId)
    || !hasBooleans(asObject(row.username), ['collectOnSignUp', 'signIn'])
  ) {
    throw invalidPublicConfig();
  }
}

function assertPrivacyConfig(value: unknown): void {
  const privacy = asObject(value);
  if (
    !Array.isArray(privacy.notices)
    || !Array.isArray(privacy.consentPurposes)
    || privacy.notices.length > 64
    || privacy.consentPurposes.length > 64
  ) throw invalidPublicConfig();

  for (const entry of privacy.notices) {
    const notice = asObject(entry);
    assertPrivacyIdentity(notice, 'noticeId', 'noticeVersionId');
    assertLocalizedText(notice.title, 512);
    assertLocalizedText(notice.body, 100_000);
    assertLocalizedDigest(notice.digest);
    if (
      !isStringArray(notice.activityCodes, 128)
      || !isStringArray(notice.purposeCodes, 128)
      || typeof notice.effectiveFrom !== 'string'
      || !Number.isFinite(Date.parse(notice.effectiveFrom))
    ) throw invalidPublicConfig();
  }
  for (const entry of privacy.consentPurposes) {
    const purpose = asObject(entry);
    assertPrivacyIdentity(purpose, 'purposeId', 'purposeVersionId');
    assertLocalizedText(purpose.title, 512);
    assertLocalizedText(purpose.description, 10_000);
    assertLocalizedDigest(purpose.digest);
    if (
      !isStringArray(purpose.activityCodes, 128)
      || !isStringArray(purpose.dataCategories, 128)
    ) throw invalidPublicConfig();
  }
}

function assertPrivacyIdentity(
  row: Record<string, unknown>,
  idKey: string,
  versionIdKey: string,
): void {
  if (
    typeof row[idKey] !== 'string'
    || !isUuid(row[idKey] as string)
    || typeof row[versionIdKey] !== 'string'
    || !isUuid(row[versionIdKey] as string)
    || typeof row.code !== 'string'
    || !/^[a-z][a-z0-9_]{0,63}$/.test(row.code)
    || !Number.isSafeInteger(row.version)
    || (row.version as number) < 1
  ) throw invalidPublicConfig();
}

function assertLocalizedText(value: unknown, maxLength: number): void {
  const text = asObject(value);
  if (
    typeof text.en !== 'string'
    || text.en.length === 0
    || text.en.length > maxLength
    || typeof text.ar !== 'string'
    || text.ar.length === 0
    || text.ar.length > maxLength
  ) throw invalidPublicConfig();
}

function assertLocalizedDigest(value: unknown): void {
  const digest = asObject(value);
  if (
    typeof digest.en !== 'string'
    || !/^[a-f0-9]{64}$/.test(digest.en)
    || typeof digest.ar !== 'string'
    || !/^[a-f0-9]{64}$/.test(digest.ar)
  ) throw invalidPublicConfig();
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function hasBooleans(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => typeof value[key] === 'boolean');
}

function optionalStrings(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) =>
    value[key] === undefined
    || (typeof value[key] === 'string' && value[key].length <= 4096));
}

/**
 * The advertised rights, or `undefined` when the server sent nothing usable.
 *
 * NEVER THROWS, unlike the rest of this file's checks. Rejecting a malformed
 * value here would not disable the privacy tab - it fails the whole public
 * config and puts the provider into its error state, so a server that ever
 * emitted the wrong shape, repeated an entry, or added a 65th right would take
 * down SIGN-IN over an advisory list. Absent is the safe reading: consumers
 * then offer every right and the server declines what it must, which is
 * exactly the behaviour that predates the field. `@authowl/flutter` parses it
 * the same way, so the two SDKs cannot disagree about a malformed server.
 */
function normalizeRightTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 128);
  return entries.length === value.length ? entries : undefined;
}

function isStringArray(value: unknown, maxItems: number): value is string[] {
  return (
    Array.isArray(value)
    && value.length <= maxItems
    && value.every((entry) => typeof entry === 'string' && entry.length <= 128)
    && new Set(value).size === value.length
  );
}
