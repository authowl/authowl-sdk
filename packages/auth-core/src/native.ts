/**
 * Native (React Native / Expo) entry point.
 *
 * The browser client relies on the browser's cookie jar, `BroadcastChannel`, and
 * `window.location` redirects - none of which exist on a phone. This entry
 * exposes the native-safe auth surface built on `createNativeAuthClient`, which
 * drops browser navigation and WebAuthn ceremonies, and leaves session storage
 * to the caller:
 *
 *   1. WHERE the session lives. Pass a `fetch` that persists and replays the
 *      session cookie from secure storage (`@authowl/react-native` supplies one).
 *
 * Social providers are supported through ID tokens obtained from their native
 * SDKs. Redirect OAuth cannot share state cookies with this client-side jar.
 *
 * Kept separate from `./index` so a React Native bundler never pulls the
 * browser-only modules into an app that cannot use them.
 */

import { resolveConfig, type AuthConfig } from './config';
import { createNativeAuthClient, type NativeAuthClient } from './native-client';

export {
  createNativeAuthClient,
  type NativeAuthClient,
  type NativePasskeyCapableClient,
  type NativeSocialSignInOptions,
  type PasskeyCeremonyClientFactory,
} from './native-client';
// The BROWSER ceremony is deliberately not re-exported here: importing it would
// pull @simplewebauthn into every React Native bundle. Native hosts pass their
// own platform ceremony instead.
export {
  createPasskeyClient,
  type PasskeyAuthenticationResponse,
  type PasskeyCeremony,
  type PasskeyRegistrationResponse,
} from './passkey-client';
export type { AddPasskeyOptions, AuthPasskey, PasskeyAuthData } from './client';
export { resolveConfig, type AuthConfig, type ResolvedAuthConfig } from './config';
export { getPublicConfig, type PublicConfig } from './public-config';
export { LOCALES, directionFor, isLocale, type Locale } from './i18n';
export { createIdempotencyKey } from './idempotency';
export { buildPrivacySignUpEvidence } from './privacy-evidence';
export {
  type CreatePrivacyRightsRequestOptions,
  type PrivacyClient,
  type PrivacyConsentPreference,
  type PrivacyConsentState,
  type PrivacyLocale,
  type PrivacyRightsRequest,
  type PrivacyRightState,
  type PrivacyRightType,
  type RecordPrivacyConsentOptions,
} from './privacy-client';
export {
  resolveProjectCapabilities,
  type ProjectCapabilities,
} from './project-capabilities';
export { sessionCookieName } from './cookie';
export { decodePublishableKey, type DecodedPublishableKey } from './key-decode';
export { createMembershipHas } from './organization-membership';
export type { HasParams, OrganizationMembership } from './organization-membership';
export type {
  Organization,
  OrganizationClient,
  OrganizationDetails,
  SetActiveOrganizationOptions,
} from './organization-client';
export type {
  AuthActionResult,
  AuthClientError,
  AuthOwlClient,
  AuthSession,
  AuthUser,
  SessionState,
  SessionStore,
  SocialAuthData,
  SocialIdTokenOptions,
} from './client';

/**
 * Build a native auth client from a publishable key and API URL.
 *
 * `config.fetch` is the seam a native app must use to persist its session:
 * without one, requests fall back to whatever cookie behaviour the platform's
 * `fetch` happens to have, which does not survive an app restart.
 */
export function createNativeClient(
  config: AuthConfig,
  onSessionMutation?: () => void,
): NativeAuthClient {
  return createNativeAuthClient(resolveConfig(config), onSessionMutation);
}
