/**
 * AuthOwl for Expo.
 *
 * `@authowl/react-native` deliberately takes its platform capabilities as
 * adapters so it carries no native dependencies. This package supplies
 * keychain-backed storage and re-exports the rest, so an Expo app installs one
 * package and passes no storage wiring of its own.
 *
 * ```tsx
 * import { AuthOwlProvider, expoStorage } from '@authowl/expo';
 *
 * <AuthOwlProvider
 *   publishableKey={process.env.EXPO_PUBLIC_AUTHOWL_PUBLISHABLE_KEY!}
 *   apiUrl={process.env.EXPO_PUBLIC_AUTHOWL_API_URL!}
 *   storage={expoStorage}
 * >
 *   <App />
 * </AuthOwlProvider>
 * ```
 */

import * as SecureStore from 'expo-secure-store';
import type { SecureStorage } from '@authowl/react-native';

export * from '@authowl/react-native';

/**
 * Session storage backed by `expo-secure-store` (iOS Keychain / Android
 * Keystore).
 *
 * Not AsyncStorage: the session cookie is a bearer credential, and AsyncStorage
 * is unencrypted files readable by anything inside the app sandbox.
 */
export const expoStorage: SecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
