/**
 * Platform passkeys on a phone.
 *
 * React Native has no `navigator.credentials`, but both platforms do have
 * passkey APIs - `ASAuthorization` on iOS, Credential Manager on Android - and
 * the community libraries (`react-native-passkey`, `expo-passkeys`) speak the
 * same WebAuthn JSON the server already emits. So the app supplies the ceremony
 * and the SDK keeps the protocol: option decoding, response projection, and the
 * in-flight de-duplication all come from `@authowl/core`.
 *
 * The adapter is the app's because the native libraries differ, need native
 * builds, and require associated-domain configuration the SDK cannot do on the
 * app's behalf.
 */

import {
  createPasskeyClient,
  type PasskeyAuthenticationResponse,
  type PasskeyCeremonyClientFactory,
  type PasskeyRegistrationResponse,
} from '@authowl/core/native';

/** The platform passkey calls an app must provide. */
export interface NativePasskeyAdapter {
  /**
   * Run the platform's registration ceremony.
   *
   * `optionsJSON` is the server's WebAuthn creation options; return the
   * credential the platform produced. Throw to signal cancellation or failure.
   */
  register(optionsJSON: unknown): Promise<PasskeyRegistrationResponse>;
  /** Run the platform's authentication ceremony. */
  authenticate(optionsJSON: unknown): Promise<PasskeyAuthenticationResponse>;
  /**
   * Optional: map a platform failure to a stable code.
   *
   * Without it a cancelled prompt is reported as a generic ceremony error. iOS
   * and Android both surface cancellation distinctly, and users cancel far more
   * often than anything actually breaks, so implementing this is worth it.
   */
  errorCode?(error: unknown): string | undefined;
}

/**
 * Adapt a platform passkey library into the factory `@authowl/core` expects.
 *
 * Pass the result as `passkeys` to `<AuthOwlProvider>`; without it the passkey
 * ceremony is absent from the client's type entirely, so an app cannot call a
 * prompt that would fail.
 */
export function createNativePasskeys(
  adapter: NativePasskeyAdapter,
): PasskeyCeremonyClientFactory {
  return (http, sessionChanged) =>
    createPasskeyClient(http, sessionChanged, {
      register: ({ optionsJSON }) => adapter.register(optionsJSON),
      authenticate: ({ optionsJSON }) => adapter.authenticate(optionsJSON),
      errorCode: adapter.errorCode?.bind(adapter),
    });
}
