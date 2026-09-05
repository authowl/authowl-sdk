// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
  user: { id: 'user-1', twoFactorEnabled: false } as { id: string; twoFactorEnabled: boolean } | null,
  sessionId: 'session-1' as string | null,
  listPasskeys: vi.fn(async (): Promise<{ data: unknown[] | null; error: unknown }> => ({
    data: [],
    error: null,
  })),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useUser: () => ({ user: mocks.user, isSignedIn: mocks.user !== null }),
  useSession: () => ({
    data: mocks.user && mocks.sessionId
      ? { user: mocks.user, session: { id: mocks.sessionId } }
      : null,
    isPending: false,
    error: null,
  }),
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
    mocks.user = { id: 'user-1', twoFactorEnabled: false };
    mocks.sessionId = 'session-1';
    mocks.config = onHost();
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'PublicKeyCredential');
  });

  const offer = () => renderHook(() => usePasskeyOffer()).result.current;

  it('offers to a signed-in user with no passkey on a reachable host', async () => {
    expect(offer().subject).toEqual({
      userId: 'user-1',
      sessionKey: 'env_1:session-1:user-1',
    });
    await expect(offer().shouldOffer()).resolves.toBe(true);
  });

  it('is not ready before the project config arrives', async () => {
    // Answering from defaults would record a decision nobody made.
    mocks.config = null;
    expect(offer().subject).toBeNull();
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('DOES offer to a user with two-factor enabled', async () => {
    // This pinned the opposite rule, and the rule was wrong. The server's
    // `passkeyAssuranceGate` allows any assertion that performed user
    // verification: a passkey with a biometric or PIN is two factors, so it
    // both signs the user in and satisfies MFA. Refusing them meant that on a
    // project with MFA required - where EVERY user is enrolled - the offer
    // could never fire for anybody.
    mocks.user = { id: 'user-1', twoFactorEnabled: true };

    expect(offer().subject).not.toBeNull();
    await expect(offer().shouldOffer()).resolves.toBe(true);
  });

  it('still suppresses a 2FA user who already has a passkey', async () => {
    // The 2FA exclusion used to short-circuit before the server was asked, so
    // relaxing it puts the WHOLE weight of "do not nag" on the listPasskeys
    // check for this population. Without this, every signed-in visit of an
    // already-enrolled 2FA user reopens the offer until they dismiss it.
    mocks.user = { id: 'user-1', twoFactorEnabled: true };
    mocks.listPasskeys.mockResolvedValue({ data: [{ id: 'passkey-1' }], error: null });

    await expect(offer().shouldOffer()).resolves.toBe(false);
    expect(mocks.listPasskeys).toHaveBeenCalled();
  });



  it('never offers where the ceremony cannot reach the relying party', async () => {
    // The engine sets no explicit rpID, so the relying party is the AUTH host.
    // A page served from anywhere else cannot run the ceremony at all - the
    // browser refuses before any network call.
    mocks.config = onHost({ authBaseUrl: 'https://accounts.example.test' });
    expect(offer().subject).toBeNull();
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('never offers when the project does not allow adding passkeys', async () => {
    mocks.config = onHost({ authentication: authentication({ signIn: true, add: false }) });
    expect(offer().subject).toBeNull();
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });

  it('never offers without WebAuthn in the browser', async () => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'PublicKeyCredential');
    expect(offer().subject).toBeNull();
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

  it('scopes the answer to the user who gave it', async () => {
    // Keyed per project alone, one account on a shared device silenced the
    // offer for every account after it.
    offer().remember(true);
    await expect(offer().shouldOffer()).resolves.toBe(false);

    mocks.user = { id: 'user-2', twoFactorEnabled: false };
    mocks.sessionId = 'session-2';
    await expect(offer().shouldOffer()).resolves.toBe(true);
  });

  it('stops asking after an enrolment and pauses after a decline', async () => {
    offer().remember(true);
    await expect(offer().shouldOffer()).resolves.toBe(false);

    localStorage.clear();
    offer().remember(false);
    await expect(offer().shouldOffer()).resolves.toBe(false);
  });
});
