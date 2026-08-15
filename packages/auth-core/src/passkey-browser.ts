/**
 * The browser WebAuthn ceremony.
 *
 * Isolated in its own module so `passkey-client.ts` - which owns the protocol,
 * the option decoding, and the in-flight de-duplication - carries no import of
 * `@simplewebauthn/browser`. React Native has platform passkey APIs but no
 * `navigator.credentials`, and a static import here would drag ~4kb gzip of
 * unusable browser code into every native bundle.
 */

import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';

import type { PasskeyCeremony } from './passkey-client';

export const browserPasskeyCeremony: PasskeyCeremony = {
  authenticate: (input) => startAuthentication(input),
  register: (input) => startRegistration(input),
  // Only this module can identify the browser helper's own error type.
  errorCode: (error) => (error instanceof WebAuthnError ? error.code : undefined),
};
