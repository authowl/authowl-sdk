/** Native social sign-in through a provider-issued ID token. */

import type {
  AuthActionResult,
  NativeAuthClient,
  NativeSocialSignInOptions,
  SocialAuthData,
} from '@authowl/core/native';

/**
 * Exchange an ID token obtained from a provider's native SDK for an AuthOwl
 * session. The cookie jar captures the session cookie from this same response,
 * so no browser-cookie bridge or deep-link credential is required.
 */
export function signInWithSocialIdToken(
  client: NativeAuthClient,
  options: NativeSocialSignInOptions,
): Promise<AuthActionResult<SocialAuthData>> {
  return client.signIn.social(options);
}

export type { NativeSocialSignInOptions as SocialIdTokenSignInOptions };
