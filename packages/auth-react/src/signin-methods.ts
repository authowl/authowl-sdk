import type { PublicConfig } from '@authowl/core';
import { resolveProjectCapabilities } from './project-capabilities';

/**
 * Pure, DOM-free resolution of which sign-in surfaces to render from a project's
 * public config. Kept out of <SignIn/> so the branching is unit-testable without
 * a renderer, and so the "which methods, and why nothing" decision lives in one
 * place.
 */

/** Method slugs the SDK can render a UI for (server contract, canonical snake_case). */
export const KNOWN_METHODS = [
  'password',
  'magic_link',
  'email_otp',
  'phone_otp',
  'passkey',
  'sso',
] as const;
export type KnownMethod = (typeof KNOWN_METHODS)[number];

/**
 * Which email input carries the `webauthn` autocomplete token for passkey
 * conditional mediation. Exactly one input can host it, so this names the first
 * email-bearing method in render-priority order (or null when passkey is off /
 * there is no email input to attach to).
 */
export type AutofillHost = 'password' | 'magic_link' | 'email_otp' | 'sso' | null;

/**
 * The primary sign-in action - the one bound to <SignIn/>'s form submit (Enter
 * key), rendered as the single filled button. Password wins when enabled;
 * otherwise the first passwordless email method in priority order. The other
 * email methods render as secondary (outlined) buttons reusing the same email.
 * `null` when no email method is enabled (social/passkey only). SSO is last in
 * priority: it is the filled submit only when it is the sole email method.
 */
export type SignInPrimary = 'password' | 'magic' | 'otp' | 'sso' | null;

export type SignInPlan = {
  password: boolean;
  username: boolean;
  magicLink: boolean;
  emailOtp: boolean;
  phoneOtp: boolean;
  passkey: boolean;
  /** Inbound enterprise SSO - an email-domain-resolved redirect method. */
  sso: boolean;
  social: string[];
  /** True when at least one surface can render. */
  renderable: boolean;
  /** The primary action (filled submit button); see {@link SignInPrimary}. */
  primary: SignInPrimary;
  /**
   * Why nothing renders, when `renderable` is false:
   *  - 'unsupported': the project enabled only methods this SDK build cannot show
   *    (the consumer needs to upgrade the SDK);
   *  - 'none': the project has no sign-in methods enabled at all.
   */
  emptyReason: 'unsupported' | 'none' | null;
  /**
   * The single email input that should arm passkey autofill. The priority order
   * here MUST match the order <SignIn/> renders these methods, so the token lands
   * on the first visible email field.
   */
  autofillHost: AutofillHost;
};

/**
 * Autocomplete value for a sign-in email input. Appends the WebAuthn token when
 * this input is the passkey conditional-mediation host so the browser surfaces
 * passkeys inline. One place owns the token string.
 */
export function emailAutocomplete(isPasskeyHost: boolean): string {
  return isPasskeyHost ? 'email webauthn' : 'email';
}

/**
 * WebAuthn's own scoping rule: an origin may run a ceremony for `rpId` only when
 * its host IS `rpId` or a subdomain of it.
 */
function hostCoveredByRelyingParty(pageHost: string, rpId: string): boolean {
  // BOTH sides lowercased. Hostnames are case-insensitive, and only one side was
  // normalized: the `authBaseUrl` fallback comes through `new URL()` already
  // lowercased, while a tenant-entered id from public-config is used verbatim -
  // so `Acme.com` hid the surface on `app.acme.com`.
  const host = pageHost.toLowerCase();
  const id = rpId.toLowerCase();
  // A bare single label is a public suffix and a browser refuses it outright.
  // `localhost` is the one legitimate single label.
  if (id !== 'localhost' && !id.includes('.')) return false;
  return host === id || host.endsWith(`.${id}`);
}

/**
 * The relying-party id the server will use, or `undefined` when it cannot be
 * known here.
 *
 * The explicit id comes from `public-config`. Absent or null means the server
 * derives it from the auth host - which is what every server before that field
 * did, and why the fallback is the old behaviour rather than a guess.
 */
function resolveRelyingPartyId(
  authBaseUrl: string | undefined,
  relyingPartyId: string | null | undefined,
): string | undefined {
  if (relyingPartyId) return relyingPartyId;
  if (!authBaseUrl) return undefined;
  try {
    // `''` for a URL that parses with an opaque path (`localhost:3000`,
    // `mailto:`, `about:blank`). That is an UNKNOWN id, and this function
    // promises to fail open on those - returning it would block instead,
    // and render a sentence naming an empty domain.
    return new URL(authBaseUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The relying-party domain that BLOCKS a WebAuthn ceremony on this page, or
 * `undefined` when one can run here.
 *
 * The engine builds its passkey plugin without an explicit `rpID` unless a
 * tenant proved one, so the id is usually the AUTH host. WebAuthn requires that
 * id to be the page's own domain or a registrable suffix of it, and an auth host
 * is neither for a page on `localhost` or `app.acme.com`. The browser refuses
 * the ceremony before any network call, surfacing as a SecurityError that reads
 * like a browser problem and is really a cross-site one no browser can satisfy.
 *
 * So a passkey is not merely unlikely to work off-host, it is IMPOSSIBLE, and
 * offering the surface is offering a dead end. Hidden rather than left to fail
 * at click time.
 *
 * Returning the DOMAIN rather than a boolean is what lets one answer both hide a
 * surface and name the host responsible. Asking separately would be two calls
 * that could disagree, forcing callers to carry a fallback for a state that
 * cannot occur.
 *
 * FAILS OPEN, for two distinct unknowables, which is why they are separate lines
 * rather than one clever expression: an unknown page host (a server render) and
 * an unknown id (a config that has not loaded) both mean "no opinion", and the
 * click-time error still guards.
 */
export function passkeyBlockingDomain(
  config: PublicConfig | null,
  pageHost: string | undefined,
): string | undefined {
  if (pageHost === undefined) return undefined;
  const rpId = resolveRelyingPartyId(
    config?.authBaseUrl,
    config?.authentication?.passkey?.relyingPartyId,
  );
  if (rpId === undefined) return undefined;
  return hostCoveredByRelyingParty(pageHost, rpId) ? undefined : rpId;
}

/** `passkeyBlockingDomain` for callers that only need the yes/no. */
export function passkeyReachableForConfig(
  config: PublicConfig | null,
  pageHost: string | undefined,
): boolean {
  return passkeyBlockingDomain(config, pageHost) === undefined;
}


/**
 * Resolve the sign-in surfaces from a project's public config. A null config
 * gets a structural password default for callers that resolve before the fetch
 * settles; the drop-in components fail closed when the fetch itself errors.
 */
export function resolveSignInMethods(
  config: PublicConfig | null,
  /** The hostname the form is rendering on; omit when it is not knowable. */
  pageHost?: string,
): SignInPlan {
  const methods = config?.enabledMethods ?? ['password'];
  const social = config?.socialProviders ?? [];
  const has = (m: KnownMethod) => methods.includes(m);
  const capabilities = resolveProjectCapabilities(config);

  const password = capabilities.passwordSignIn;
  const username = capabilities.usernameSignIn;
  const magicLink = capabilities.magicLinkSignIn;
  // Email OTP cannot satisfy the password-gated MFA
  // challenge for an enrolled user. Advertising it here creates a dead end:
  // the code succeeds as a first factor, then the server asks the user to start
  // again with their password. Keep the method configured on the project, but
  // hide it from sign-in while MFA is enabled.
  const emailOtp = capabilities.emailOtpSignIn
    && !capabilities.totp
    && !capabilities.mfaRequired;
  // Required MFA guarantees that every reachable account has a credential
  // password and must enter through password + TOTP. Optional MFA still keeps
  // phone visible for phone-only users; an enrolled account receives the typed
  // TWO_FACTOR_REQUIRED response and is guided back to password sign-in.
  const phoneOtp = capabilities.phoneSignIn && !capabilities.mfaRequired;
  const passkey = capabilities.passkeySignIn && passkeyReachableForConfig(config, pageHost);
  const sso = has('sso');
  const renderable =
    password || username || magicLink || emailOtp || phoneOtp || passkey || sso
    || social.length > 0;
  const emptyReason = renderable ? null : methods.length > 0 ? 'unsupported' : 'none';

  // Method priority in ONE place: password, then magic-link, then email-OTP,
  // then SSO. <SignIn/> renders this as the primary submit; the passkey autofill
  // host is the same first email input (so the webauthn token lands on it).
  const primary: SignInPrimary = password
    ? 'password'
    : magicLink
      ? 'magic'
      : emailOtp
        ? 'otp'
        : sso
          ? 'sso'
          : null;
  const AUTOFILL_SLUG = {
    password: 'password',
    magic: 'magic_link',
    otp: 'email_otp',
    sso: 'sso',
  } as const;
  const autofillHost: AutofillHost = passkey && primary ? AUTOFILL_SLUG[primary] : null;

  return {
    password,
    username,
    magicLink,
    emailOtp,
    phoneOtp,
    passkey,
    sso,
    social,
    renderable,
    primary,
    emptyReason,
    autofillHost,
  };
}
