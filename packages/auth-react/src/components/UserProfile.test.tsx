// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * What a mocked client action can hand back. Spelled out because these two
 * actions genuinely return BOTH shapes - the second-factor step-up tests drive
 * the failure branch - and inferring the type from the happy-path default would
 * make the gated result unassignable.
 */
type MockResult<T> = { data: T | null; error: { code: string; status: number } | null };

const mocks = vi.hoisted(() => {
  const user = {
    id: 'user-1',
    email: 'mona@example.test' as string | null,
    emailVerified: true,
    phoneNumber: null as string | null,
    name: 'Mona',
    username: null as string | null,
    displayUsername: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null,
    image: null,
    twoFactorEnabled: false,
    createdAt: new Date('2026-07-14T08:00:00.000Z'),
    updatedAt: new Date('2026-07-14T08:00:00.000Z'),
  };
  const account = {
    updateProfile: vi.fn(async () => ({ data: { status: true }, error: null })),
    changeEmail: vi.fn(async () => ({ data: { status: true }, error: null })),
    changePassword: vi.fn(async () => ({ data: { user }, error: null })),
    listSessions: vi.fn(async () => ({ data: [], error: null })),
    revokeSession: vi.fn(async () => ({ data: { status: true }, error: null })),
    revokeOtherSessions: vi.fn(async () => ({ data: { status: true }, error: null })),
    listSocialAccounts: vi.fn(async () => ({ data: [], error: null })),
    linkSocial: vi.fn(async () => ({ data: { url: '', redirect: false }, error: null })),
    unlinkSocial: vi.fn(async () => ({ data: { status: true }, error: null })),
    delete: vi.fn(async () => ({ data: { success: true, message: 'ok' }, error: null })),
  };
  const passkeys = {
    listPasskeys: vi.fn(async () => ({ data: [{ id: 'passkey-1', name: 'MacBook' }], error: null })),
    addPasskey: vi.fn(async () => ({ data: { id: 'passkey-2', name: 'Phone' }, error: null })),
    updatePasskey: vi.fn(async () => ({ data: { passkey: { id: 'passkey-1', name: 'Laptop' } }, error: null })),
    deletePasskey: vi.fn(async () => ({ data: { status: true }, error: null })),
  };
  const mfa = {
    enable: vi.fn(),
    disable: vi.fn(async (): Promise<MockResult<{ status: boolean }>> => ({ data: { status: true }, error: null })),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
    regenerateBackupCodes: vi.fn(
      async (): Promise<MockResult<{ backupCodes: string[] }>> => ({
        data: { backupCodes: ['code-1'] },
        error: null,
      }),
    ),
  };
  const config = {
    enabledMethods: ['password', 'passkey'],
    socialProviders: ['google'],
    twoFactor: true,
    mfaRequired: true,
    accountDeletion: true,
    authentication: undefined as {
      email: { signUp: boolean; signIn: Array<'password' | 'magic_link' | 'email_otp'> };
      phone: { signUp: boolean; signIn: boolean };
      password: { signUp: boolean; add: boolean };
      passkey: { signIn: boolean; add: boolean };
      username: { collectOnSignUp: boolean; signIn: boolean };
    } | undefined,
    userModel: undefined as {
      requireEmail: boolean;
      firstLastName: boolean;
      emailChange: boolean;
      accountDeletion: boolean;
    } | undefined,
    mfa: undefined as {
      totp: boolean;
      required: boolean;
      backupCodes: boolean;
    } | undefined,
  };
  return {
    user,
    account,
    passkeys,
    mfa,
    config,
    refetch: vi.fn(),
    signOut: vi.fn(),
    serverError: vi.fn((_error: unknown, fallback: string) => fallback),
  };
});

vi.mock('../hooks', () => ({
  useAccount: () => mocks.account,
  usePublicConfig: () => ({
    config: mocks.config,
    isLoading: false,
    isError: false,
  }),
  useUser: () => ({
    user: mocks.user,
    isLoaded: true,
    isSignedIn: true,
    needsMfaEnrollment: false,
    error: null,
  }),
  useSession: () => ({
    data: {
      user: mocks.user,
      session: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date('2026-07-21T08:00:00.000Z'),
      },
    },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: mocks.refetch,
  }),
  useSignOut: () => ({ signOut: mocks.signOut }),
  usePasskeys: () => mocks.passkeys,
  useMFA: () => mocks.mfa,
}));

vi.mock('../i18n', () => ({
  Bidi: ({ children }: { children: React.ReactNode }) => <bdi>{children}</bdi>,
  useLocale: () => 'en',
  useServerError: () => mocks.serverError,
  useT: () => (key: string, params?: Record<string, string | number>) => {
    let message = key;
    for (const [name, value] of Object.entries(params ?? {})) {
      message = message.replace(`{${name}}`, String(value));
    }
    return message;
  },
}));

import { UserButton } from './UserButton';
import { UserProfile } from './UserProfile';

describe('UserProfile', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.clearAllMocks();
    mocks.user.twoFactorEnabled = false;
    mocks.user.email = 'mona@example.test';
    mocks.user.emailVerified = true;
    mocks.user.phoneNumber = null;
    mocks.user.username = null;
    mocks.user.displayUsername = null;
    mocks.user.firstName = null;
    mocks.user.lastName = null;
    Object.assign(mocks.config, {
      enabledMethods: ['password', 'passkey'],
      socialProviders: ['google'],
      twoFactor: true,
      mfaRequired: true,
      accountDeletion: true,
      authentication: undefined,
      userModel: undefined,
      mfa: undefined,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('deep-links between account sections and submits profile changes', async () => {
    render(<UserProfile />);

    fireEvent.click(screen.getByRole('button', { name: 'userProfile.nav.email' }));
    expect(window.location.hash).toBe('#authowl-profile-email');
    expect(screen.getByRole('heading', { name: 'userProfile.email.title' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'userProfile.nav.profile' }));
    fireEvent.change(screen.getByLabelText('signUp.nameLabel'), { target: { value: 'Mona Ali' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.save' }));

    await waitFor(() => expect(mocks.account.updateProfile).toHaveBeenCalledWith({
      name: 'Mona Ali',
      image: null,
    }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('opens from UserButton and restores focus after modal close', async () => {
    const { container } = render(
      <div className="authowl-root">
        <header data-testid="filtered-host-header" style={{ backdropFilter: 'blur(14px)' }}>
          <UserButton />
        </header>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'userButton.openMenuAria' });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'userButton.manageAccount' }));
    const dialog = screen.getByRole('dialog', { name: 'userProfile.title' });
    const providerRoot = container.querySelector('.authowl-root');
    expect(dialog).toBeTruthy();
    expect(dialog.parentElement?.parentElement).toBe(providerRoot);
    expect(screen.getByTestId('filtered-host-header').contains(dialog)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'userProfile.close' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes modal mode with Escape', () => {
    const onClose = vi.fn();
    render(<UserProfile mode="modal" onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not describe a failed initial resource load as an empty account', async () => {
    mocks.account.listSocialAccounts.mockRejectedValueOnce(new Error('network unavailable'));
    render(<UserProfile defaultSection="social" />);

    expect((await screen.findByRole('alert')).textContent).toContain('userProfile.social.loadError');
    expect(screen.queryByText('userProfile.social.empty')).toBeNull();
  });

  it('drives passkey removal through a named confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<UserProfile defaultSection="passkeys" />);

    fireEvent.click(await screen.findByRole('button', { name: 'passkeys.remove' }));

    expect(confirm).toHaveBeenCalledWith('passkeys.removeConfirm');
    await waitFor(() => expect(mocks.passkeys.deletePasskey).toHaveBeenCalledWith({ id: 'passkey-1' }));
  });

  it('explains required MFA replacement and disables the factor after password confirmation', async () => {
    mocks.user.twoFactorEnabled = true;
    render(<UserProfile defaultSection="mfa" />);

    expect(screen.getByText('userProfile.mfa.requiredActive')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replace' }));
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), { target: { value: 'password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replaceConfirm' }));

    await waitFor(() => expect(mocks.mfa.disable).toHaveBeenCalledWith({ password: 'password-1' }));
    expect(mocks.refetch).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
  });

  // Plan 43.3 gates BOTH weakening endpoints on a fresh second-factor proof, not
  // on the password. Before these, the shipped UI collected a password only, so
  // the gate was a dead end: the server asked for a code and no screen could
  // take one. These prove the whole journey, including that the parked request
  // replays with the password already entered.
  describe('second-factor step-up', () => {
    const gated = { data: null, error: { code: 'SECOND_FACTOR_REQUIRED', status: 403 } };

    it('collects a code and finishes the removal the server gated', async () => {
      mocks.user.twoFactorEnabled = true;
      mocks.mfa.disable
        .mockResolvedValueOnce(gated)
        .mockResolvedValueOnce({ data: { status: true }, error: null });
      mocks.mfa.verifyTotp.mockResolvedValue({ data: { token: 'session-token' }, error: null });
      render(<UserProfile defaultSection="mfa" />);

      fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replace' }));
      fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
        target: { value: 'password-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replaceConfirm' }));

      // The gate swaps in a code prompt instead of telling the user their
      // password was rejected - which is what the raw server message read like.
      const code = await screen.findByLabelText('mfa.challenge.totpLabel');
      expect(screen.queryByRole('alert')).toBeNull();

      fireEvent.change(code, { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.submit' }));

      await waitFor(() => expect(mocks.mfa.verifyTotp).toHaveBeenCalledWith({
        code: '123456',
        trustDevice: false,
      }));
      await waitFor(() => expect(mocks.mfa.disable).toHaveBeenCalledTimes(2));
      expect(mocks.mfa.disable).toHaveBeenLastCalledWith({ password: 'password-1' });
      expect(mocks.refetch).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
    });

    it('does not replay the removal when the code is rejected', async () => {
      mocks.user.twoFactorEnabled = true;
      mocks.mfa.disable.mockResolvedValueOnce(gated);
      mocks.mfa.verifyTotp.mockResolvedValue({
        data: null,
        error: { code: 'INVALID_CODE', status: 401 },
      });
      render(<UserProfile defaultSection="mfa" />);

      fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replace' }));
      fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
        target: { value: 'password-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replaceConfirm' }));

      const code = await screen.findByLabelText('mfa.challenge.totpLabel');
      fireEvent.change(code, { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.submit' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(mocks.mfa.disable).toHaveBeenCalledTimes(1);
    });

    it('abandons the parked removal on cancel', async () => {
      mocks.user.twoFactorEnabled = true;
      mocks.mfa.disable.mockResolvedValueOnce(gated);
      render(<UserProfile defaultSection="mfa" />);

      fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replace' }));
      fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
        target: { value: 'password-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replaceConfirm' }));

      fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }));

      expect(screen.getByRole('button', { name: 'userProfile.mfa.replace' })).toBeTruthy();
      expect(mocks.mfa.disable).toHaveBeenCalledTimes(1);
    });

    it('gates reissuing backup codes through the same prompt', async () => {
      mocks.user.twoFactorEnabled = true;
      mocks.mfa.regenerateBackupCodes
        .mockResolvedValueOnce(gated)
        .mockResolvedValueOnce({ data: { backupCodes: ['code-9'] }, error: null });
      mocks.mfa.verifyBackupCode.mockResolvedValue({ data: { token: 'session-token' }, error: null });
      render(<UserProfile defaultSection="recovery" />);

      fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
        target: { value: 'password-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'backupCodes.submit' }));

      // The same prompt, reached from the other weakening endpoint.
      fireEvent.click(await screen.findByText('mfa.challenge.useBackup'));
      fireEvent.change(screen.getByLabelText('mfa.challenge.backupLabel'), {
        target: { value: 'backup-code-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.submit' }));

      await waitFor(() => expect(mocks.mfa.regenerateBackupCodes).toHaveBeenCalledTimes(2));
      expect(mocks.mfa.regenerateBackupCodes).toHaveBeenLastCalledWith({ password: 'password-1' });
      expect(await screen.findByText('code-9')).toBeTruthy();
    });
  });

  it('shows recovery only for an enrolled user and deletes only after email confirmation', async () => {
    mocks.user.twoFactorEnabled = true;
    const onDeleted = vi.fn();
    render(<UserProfile defaultSection="danger" onDeleted={onDeleted} />);

    expect(screen.getByRole('button', { name: 'userProfile.nav.recovery' })).toBeTruthy();
    const confirmation = screen.getByRole('textbox');
    expect(screen.getByRole('button', { name: 'userProfile.delete.submit' })).toHaveProperty('disabled', true);
    fireEvent.change(confirmation, { target: { value: 'mona@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.delete.submit' }));

    await waitFor(() => expect(mocks.account.delete).toHaveBeenCalledOnce());
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it('uses a phone identifier for deletion when the account has no email', async () => {
    mocks.user.email = null;
    mocks.user.phoneNumber = '01000000000';
    render(<UserProfile defaultSection="danger" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '01000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.delete.submit' }));

    await waitFor(() => expect(mocks.account.delete).toHaveBeenCalledOnce());
  });

  it('does not promise email recovery without a verified address', () => {
    mocks.user.twoFactorEnabled = true;
    mocks.user.emailVerified = false;
    render(<UserProfile defaultSection="recovery" />);

    expect(screen.getByText('userProfile.recovery.emailUnavailable')).toBeTruthy();
    expect(screen.queryByText('userProfile.recovery.emailDescription')).toBeNull();
  });

  it('keeps existing passkeys manageable while policy disables registration', async () => {
    Object.assign(mocks.config, {
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true },
        passkey: { signIn: true, add: false },
        username: { collectOnSignUp: false, signIn: false },
      },
    });
    render(<UserProfile defaultSection="passkeys" />);

    expect(await screen.findByRole('button', { name: 'passkeys.remove' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'passkeys.add' })).toBeNull();
  });

  it('shows current email but removes the change form when policy forbids changes', () => {
    Object.assign(mocks.config, {
      userModel: {
        requireEmail: true,
        firstLastName: false,
        emailChange: false,
        accountDeletion: true,
      },
    });
    render(<UserProfile defaultSection="email" />);

    expect(screen.getByText('mona@example.test')).toBeTruthy();
    expect(screen.getByTestId('email-change-disabled')).toBeTruthy();
    expect(screen.queryByLabelText('userProfile.email.newLabel')).toBeNull();
  });

  it('edits structured names and username when those profile fields are enabled', async () => {
    mocks.user.firstName = 'Mona';
    mocks.user.lastName = 'Ali';
    mocks.user.displayUsername = 'Mona_1';
    Object.assign(mocks.config, {
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true },
        passkey: { signIn: false, add: false },
        username: { collectOnSignUp: true, signIn: true },
      },
      userModel: {
        requireEmail: true,
        firstLastName: true,
        emailChange: true,
        accountDeletion: true,
      },
    });
    render(<UserProfile />);

    fireEvent.change(screen.getByLabelText('signUp.firstNameLabel'), {
      target: { value: 'Mariam' },
    });
    fireEvent.change(screen.getByLabelText('common.usernameLabel'), {
      target: { value: 'Mariam_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.save' }));

    await waitFor(() => expect(mocks.account.updateProfile).toHaveBeenCalledWith({
      firstName: 'Mariam',
      lastName: 'Ali',
      username: 'Mariam_2',
      image: null,
    }));
  });
});
