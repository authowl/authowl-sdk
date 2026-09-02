import type {
  AddPasskeyOptions,
  ActionFetchOptions,
  AuthActionResult,
  AuthPasskey,
  PasskeyAuthData,
  PasskeySignInOptions,
} from './client';
import type { AuthHttpClient } from './http-client';
import {
  decodeAuthenticationOptions,
  decodePasskeyAuthentication,
  decodeRegisteredPasskey,
  decodeRegistrationOptions,
} from './passkey-response';
import {
  invalidPasskeyName,
  validatePasskeyName,
} from './passkey-name';

/**
 * The two ceremony responses, as the server expects to receive them.
 *
 * Kept distinct: an assertion carries `authenticatorData`, an attestation
 * carries `attestationObject`, and collapsing them into one type would let a
 * registration response be posted to the authentication endpoint.
 */
export type PasskeyRegistrationResponse = {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
  };
  clientExtensionResults?: unknown;
  authenticatorAttachment?: string;
};
export type PasskeyAuthenticationResponse = {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults?: unknown;
  authenticatorAttachment?: string;
};

/**
 * Runs the platform's WebAuthn ceremonies.
 *
 * Injected so a non-browser runtime can supply its own. React Native has no
 * `navigator.credentials`, but it does have platform passkey APIs
 * (`ASAuthorization` on iOS, Credential Manager on Android) whose libraries
 * speak the same WebAuthn JSON. Parameterizing only the ceremony lets those
 * runtimes reuse every line of option decoding, response projection, and
 * in-flight de-duplication below, instead of reimplementing the protocol.
 */
export interface PasskeyCeremony {
  authenticate(input: {
    optionsJSON: ReturnType<typeof decodeAuthenticationOptions>;
    useBrowserAutofill?: boolean;
  }): Promise<PasskeyAuthenticationResponse>;
  register(input: {
    optionsJSON: ReturnType<typeof decodeRegistrationOptions>;
  }): Promise<PasskeyRegistrationResponse>;
  /**
   * Classify a ceremony failure, returning the platform's error code.
   *
   * Supplied by the ceremony because only it knows its own error type. The
   * browser implementation tests `instanceof WebAuthnError`; doing that here
   * would require importing the browser helper into this module, and a
   * structural stand-in cannot work - a real WebAuthnError takes its `name`
   * from the underlying cause, not from the class.
   */
  errorCode?(error: unknown): string | undefined;
}

export function createPasskeyClient(
  http: AuthHttpClient,
  sessionChanged: () => void | Promise<void>,
  ceremony: PasskeyCeremony,
) {
  const authenticationVerificationsInFlight =
    new Map<string, Promise<AuthActionResult<PasskeyAuthData>>>();

  return {
    async signIn(
      options: PasskeySignInOptions = {},
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<PasskeyAuthData>> {
      const generated = await http.request<unknown>(
        '/passkey/generate-authenticate-options',
      );
      if (!generated.data) return missingOptions(generated.error);
      let ceremonyOptions;
      try {
        ceremonyOptions = decodeAuthenticationOptions(generated.data);
      } catch {
        return invalidOptions();
      }
      let response: PasskeyAuthenticationResponse;
      try {
        response = await ceremony.authenticate({
          optionsJSON: ceremonyOptions,
          useBrowserAutofill: options.autoFill,
        });
      } catch (error) {
        return ceremonyError(
          ceremony, error, 'AUTH_CANCELLED', 'Passkey authentication was cancelled.',
        );
      }
      if (!isAuthenticationResponse(response)) return invalidResponse();
      const { clientExtensionResults: _extensions, ...responseBody } = response;
      // Conditional mediation and the explicit passkey button can resolve at
      // nearly the same time. Collapse their verification requests so one user
      // gesture cannot mint duplicate sessions. Key by credential so unrelated
      // authenticators are never coupled.
      const existingVerification = authenticationVerificationsInFlight.get(response.id);
      if (existingVerification) {
        return existingVerification;
      }
      const verification = (async () => {
        const verified = await http.request<PasskeyAuthData>(
          '/passkey/verify-authentication',
          {
            method: 'POST',
            body: { response: responseBody },
            fetchOptions,
            decode: decodePasskeyAuthentication,
          },
        );
        if (verified.data) await sessionChanged();
        return verified;
      })();
      authenticationVerificationsInFlight.set(response.id, verification);
      try {
        return await verification;
      } finally {
        if (authenticationVerificationsInFlight.get(response.id) === verification) {
          authenticationVerificationsInFlight.delete(response.id);
        }
      }
    },

    async add(
      options: AddPasskeyOptions = {},
      fetchOptions?: ActionFetchOptions,
    ): Promise<AuthActionResult<AuthPasskey>> {
      const name = validatePasskeyName(options.name);
      if (!name.valid) return invalidPasskeyName();
      const generated = await http.request<unknown>(
        '/passkey/generate-register-options',
        {
          query: {
            name: name.value,
            authenticatorAttachment: options.authenticatorAttachment,
          },
        },
      );
      if (!generated.data) return missingOptions(generated.error);
      let ceremonyOptions;
      try {
        ceremonyOptions = decodeRegistrationOptions(generated.data);
      } catch {
        return invalidOptions();
      }
      let response: PasskeyRegistrationResponse;
      try {
        response = await ceremony.register({ optionsJSON: ceremonyOptions });
      } catch (error) {
        return ceremonyError(
          ceremony, error, 'REGISTRATION_CANCELLED', 'Passkey registration was cancelled.',
        );
      }
      if (!isRegistrationResponse(response)) return invalidResponse();
      const { clientExtensionResults: _extensions, ...responseBody } = response;
      const verified = await http.request<AuthPasskey>(
        '/passkey/verify-registration',
        {
          method: 'POST',
          body: { response: responseBody, name: name.value },
          fetchOptions,
          decode: (value) =>
            decodeRegisteredPasskey(value, response.id, name.value),
        },
      );
      if (verified.data) sessionChanged();
      return verified;
    },
  };
}

function invalidOptions<T>(): AuthActionResult<T> {
  return {
    data: null,
    error: {
      status: 502,
      statusText: 'BAD_GATEWAY',
      code: 'INVALID_WEBAUTHN_OPTIONS',
      message: 'The server returned invalid WebAuthn options.',
    },
  };
}

function invalidResponse<T>(): AuthActionResult<T> {
  return {
    data: null,
    error: {
      status: 400,
      statusText: 'BAD_REQUEST',
      code: 'INVALID_WEBAUTHN_RESPONSE',
      message: 'The platform returned an invalid passkey response.',
    },
  };
}

function isCredentialBase(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && row.id.length > 0
    && typeof row.rawId === 'string'
    && row.rawId.length > 0
    && row.type === 'public-key'
    && !!row.response
    && typeof row.response === 'object';
}

function isAuthenticationResponse(value: unknown): value is PasskeyAuthenticationResponse {
  if (!isCredentialBase(value)) return false;
  const response = value.response as Record<string, unknown>;
  return typeof response.clientDataJSON === 'string'
    && typeof response.authenticatorData === 'string'
    && typeof response.signature === 'string'
    && (response.userHandle === undefined || typeof response.userHandle === 'string');
}

function isRegistrationResponse(value: unknown): value is PasskeyRegistrationResponse {
  if (!isCredentialBase(value)) return false;
  const response = value.response as Record<string, unknown>;
  return typeof response.clientDataJSON === 'string'
    && typeof response.attestationObject === 'string';
}

function missingOptions<T>(error: AuthActionResult<unknown>['error']): AuthActionResult<T> {
  return {
    data: null,
    error: error ?? {
      status: 502,
      statusText: 'BAD_GATEWAY',
      code: 'INVALID_WEBAUTHN_OPTIONS',
      message: 'The server returned no WebAuthn options.',
    },
  };
}

function ceremonyError<T>(
  ceremony: PasskeyCeremony,
  error: unknown,
  cancelledCode: string,
  cancelledMessage: string,
): AuthActionResult<T> {
  const pageNotFocused = errorChainContains(error, 'page does not have focus');
  const webAuthnCode = ceremony.errorCode?.(error);
  const cancelled =
    webAuthnCode !== undefined
      ? webAuthnCode === 'ERROR_CEREMONY_ABORTED'
      : errorName(error) === 'AbortError';
  const registering = cancelledCode !== 'AUTH_CANCELLED';
  const genericMessage = explainCeremonyFailure(webAuthnCode, errorName(error), registering);
  return {
    data: null,
    error: {
      status: 400,
      statusText: 'BAD_REQUEST',
      code: pageNotFocused
        ? 'PASSKEY_PAGE_NOT_FOCUSED'
        : cancelled
          ? cancelledCode
          : webAuthnCode ?? 'PASSKEY_BROWSER_ERROR',
      message: pageNotFocused
        ? 'Keep this page focused while completing the passkey prompt.'
        : cancelled
          ? cancelledMessage
          : genericMessage,
    },
  };
}

/**
 * Say what actually went wrong, rather than blaming the browser for it.
 *
 * Every non-cancel failure used to collapse into "could not be completed by this
 * browser", which is wrong for almost all of them and unactionable for the rest:
 * a relying-party id that does not cover the page is a CONFIGURATION fact, an
 * authenticator that already holds a credential is a STATE fact, and no passkey
 * on the device is an ordinary outcome the user can fix by registering one. The
 * founder hit the last of these and saw a spinner followed by a browser
 * accusation, with nothing naming the actual cause.
 *
 * `NotAllowedError` stays deliberately vague, because WebAuthn makes it vague on
 * purpose: cancelled, timed out, and no-matching-credential are indistinguishable
 * so a site cannot probe which passkeys you hold. The message covers the useful
 * possibilities instead of asserting one.
 */
export function explainCeremonyFailure(
  webAuthnCode: string | undefined,
  name: string | undefined,
  registering: boolean,
): string {
  switch (webAuthnCode) {
    case 'ERROR_INVALID_DOMAIN':
    case 'ERROR_INVALID_RP_ID':
      return 'Passkeys are not set up for this site\u2019s domain.';
    case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
      return 'This device already has a passkey for this account.';
    case 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEY_ALGS':
    case 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT':
    case 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT':
      return 'This device cannot create a passkey for this site.';
    default:
      break;
  }
  if (name === 'NotAllowedError') {
    return registering
      ? 'No passkey was created. The prompt was dismissed or timed out.'
      : 'No passkey was used. This device may not have one saved for this site yet, '
        + 'or the prompt was dismissed.';
  }
  if (name === 'SecurityError') {
    return 'Passkeys are not set up for this site\u2019s domain.';
  }
  return registering
    ? 'Passkey registration did not complete.'
    : 'Passkey sign-in did not complete.';
}

function errorName(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'name' in error
    && typeof error.name === 'string'
    ? error.name
    : undefined;
}

function errorChainContains(error: unknown, needle: string): boolean {
  const normalizedNeedle = needle.toLowerCase();
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (
      'message' in current &&
      typeof current.message === 'string' &&
      current.message.toLowerCase().includes(normalizedNeedle)
    ) {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
