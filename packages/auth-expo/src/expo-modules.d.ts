/**
 * Minimal ambient declarations for the Expo modules this package adapts.
 *
 * They are PEER dependencies, so they are not installed in this monorepo and
 * would otherwise break `tsc --noEmit` in CI. Declaring only the members used
 * here keeps the build honest without vendoring Expo's full type surface - and
 * if Expo changes one of these signatures, the mismatch surfaces in a consuming
 * app's build rather than being silently papered over by `any`.
 */

declare module 'expo-secure-store' {
  export interface SecureStoreOptions {
    keychainService?: string;
    requireAuthentication?: boolean;
  }
  export function getItemAsync(
    key: string,
    options?: SecureStoreOptions,
  ): Promise<string | null>;
  export function setItemAsync(
    key: string,
    value: string,
    options?: SecureStoreOptions,
  ): Promise<void>;
  export function deleteItemAsync(
    key: string,
    options?: SecureStoreOptions,
  ): Promise<void>;
}
