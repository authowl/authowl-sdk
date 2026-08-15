/**
 * Where a native app keeps its session.
 *
 * The session cookie is a bearer credential: anything holding it IS the signed-in
 * user until it expires. On a phone that means the OS keychain / keystore, not
 * AsyncStorage, which is plain unencrypted files any process with the sandbox
 * can read. `@authowl/expo` supplies an `expo-secure-store` adapter; bare React
 * Native apps typically use `react-native-keychain`.
 */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * An in-memory store, for tests and for previews where persistence is unwanted.
 *
 * Explicitly NOT a default: silently falling back to memory would make sign-in
 * appear to work and then drop the session on the next app launch, which is a
 * confusing bug to chase. Callers must choose their storage.
 */
export class MemoryStorage implements SecureStorage {
  private readonly entries = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
