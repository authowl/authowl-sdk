/** Building the AuthOwl client for a native app. */

import {
  createNativeAuthClient,
  decodePublishableKey,
  getPublicConfig,
  resolveConfig,
  type NativeAuthClient,
  type NativePasskeyCapableClient,
  type PasskeyCeremonyClientFactory,
  type PublicConfig,
} from '@authowl/core/native';

import { createCookieJarFetch } from './cookie-jar';
import type { SecureStorage } from './storage';

export interface AuthOwlNativeConfig {
  /** The project's `pk_live_…` / `pk_test_…` key. Secret keys are refused. */
  publishableKey: string;
  /** The AuthOwl API origin, e.g. `https://api.authowl.dev`. */
  apiUrl: string;
  /** Where the session cookie is persisted. Use the OS keychain in production. */
  storage: SecureStorage;
  /** Defaults to the global fetch. Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Called after any action that mutates the session. */
  onSessionMutation?: () => void;
  /**
   * Platform passkey ceremony, from `createNativePasskeys()`.
   *
   * Omit it and the passkey methods are absent from the client's TYPE, so an
   * app cannot call a prompt the runtime could never show.
   */
  passkeys?: PasskeyCeremonyClientFactory;
}

export interface AuthOwlNativeConfigWithPasskeys extends AuthOwlNativeConfig {
  passkeys: PasskeyCeremonyClientFactory;
}

interface AuthOwlNativeBase {
  projectId: string;
  getPublicConfig: () => Promise<PublicConfig>;
}

export interface AuthOwlNative extends AuthOwlNativeBase {
  client: NativeAuthClient | NativePasskeyCapableClient;
}

export interface AuthOwlPasskeyNative extends AuthOwlNativeBase {
  client: NativePasskeyCapableClient;
}

export interface AuthOwlHeadlessNative extends AuthOwlNativeBase {
  client: NativeAuthClient;
}

/**
 * Build a native AuthOwl client with session persistence wired up.
 *
 * The publishable key is decoded up front so a `sk_` key fails HERE, loudly, at
 * startup - rather than being shipped inside an app binary where it cannot be
 * rotated out of users' hands.
 */
export function createAuthOwlNative(
  config: AuthOwlNativeConfigWithPasskeys,
): AuthOwlPasskeyNative;
export function createAuthOwlNative(
  config: AuthOwlNativeConfig & { passkeys?: undefined },
): AuthOwlHeadlessNative;
export function createAuthOwlNative(config: AuthOwlNativeConfig): AuthOwlNative;
export function createAuthOwlNative(config: AuthOwlNativeConfig): AuthOwlNative {
  const { projectId } = decodePublishableKey(config.publishableKey);

  // The cookie prefix depends on the SERVER's cookie mode, which follows the API
  // URL's scheme - `http://localhost` in development sets an unprefixed cookie.
  const secure = new URL(config.apiUrl).protocol === 'https:';

  const resolved = resolveConfig({
    publishableKey: config.publishableKey,
    apiUrl: config.apiUrl,
    fetch: createCookieJarFetch({
      storage: config.storage,
      projectId,
      secure,
      fetchImpl: config.fetchImpl,
    }),
  });

  const client = config.passkeys
    ? createNativeAuthClient(resolved, config.onSessionMutation, config.passkeys)
    : createNativeAuthClient(resolved, config.onSessionMutation);

  return { client, projectId, getPublicConfig: () => getPublicConfig(resolved) };
}
