// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
  user: { twoFactorEnabled: false } as { twoFactorEnabled: boolean } | null,
  listPasskeys: vi.fn(async (): Promise<{ data: unknown[] | null; error: unknown }> => ({
    data: [],
    error: null,
  })),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useUser: () => ({ user: mocks.user }),
  usePasskeys: () => ({ listPasskeys: mocks.listPasskeys }),
}));

import { usePasskeyOffer } from './use-passkey-offer';

/**
 * A project whose auth host IS the page host, where a ceremony can run. jsdom
 * serves the test from localhost, so that is the reachable relying party here.
 */
const authentication = (passkey: { signIn: boolean; add: boolean }) => ({
  email: { signUp: true, signIn: ['password'] },
  phone: { signUp: false, signIn: false },
  password: { signUp: true, add: true },
  username: { collectOnSignUp: false, signIn: false },
  passkey,
});

const onHost = (over: Record<string, unknown> = {}) => ({
  environmentId: 'env_1',
  authBaseUrl: 'http://localhost:3000',
  enabledMethods: ['password', 'passkey'],
  authentication: authentication({ signIn: true, add: true }),
  ...over,
}) as unknown as PublicConfig;

describe('usePasskeyOffer', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.listPasskeys.mockResolvedValue({ data: [], error: null });
    mocks.user = { twoFactorEnabled: false };
    mocks.config = onHost();
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'PublicKeyCredential');
  });

  const offer = () => renderHook(() => usePasskeyOffer()).result.current;

  it('offers to a signed-in user with no passkey on a reachable host', async () => {
    await expect(offer().shouldOffer()).resolves.toBe(true);
  });

  it('never offers to a user with two-factor enabled', async () => {
    // A 2FA-enrolled user cannot complete a passkey sign-in at all today, so
    // the credential could never be used. Offering it would ship a dead end.
    mocks.user = { twoFactorEnabled: true };
    await expect(offer().shouldOffer()).resolves.toBe(false);
    expect(mocks.listPasskeys).not.toHaveBeenCalled();
  });

  it('never offers where the ceremony cannot reach the relying party', async () => {
    // The engine sets no explicit rpID, so the relying party is the AUTH host.
    // A page served from anywhere else cannot run the ceremony at all - the
    // browser refuses before any network call.
    mocks.config = onHost({ authBaseUrl: 'https://accounts.example.test' });
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('never offers when the project does not allow adding passkeys', async () => {
    mocks.config = onHost({ authentication: authentication({ signIn: true, add: false }) });
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('never offers without WebAuthn in the browser', async () => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'PublicKeyCredential');
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('does not offer to someone who already has a passkey', async () => {
    // Synced from another device, or added on the account page - invisible to
    // this browser's own memory, which is why the server is asked.
    mocks.listPasskeys.mockResolvedValue({ data: [{ id: 'passkey-1' }], error: null });
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('stays quiet when the passkey list cannot be read', async () => {
    // Not knowing is not a reason to interrupt a working sign-in.
    mocks.listPasskeys.mockResolvedValue({ data: null, error: { code: 'BOOM' } });
    await expect(offer().shouldOffer()).resolves.toBe(false);

    mocks.listPasskeys.mockRejectedValue(new Error('offline'));
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('stops asking after an enrolment and pauses after a decline', async () => {
    offer().settle(true);
    await expect(offer().shouldOffer()).resolves.toBe(false);

    localStorage.clear();
    offer().settle(false);
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });
});
