// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthActionResult } from '@authowl/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
    disable: vi.fn(async (): Promise<AuthActionResult<{ status: boolean }>> => ({ data: { status: true }, error: null })),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
    regenerateBackupCodes: vi.fn(
      async (): Promise<AuthActionResult<{ backupCodes: string[] }>> => ({
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

vi.mock('./PrivacyCenter', () => ({ PrivacyCenter: () => <div data-testid="privacy-center" /> }));

vi.mock('../i18n', () => ({
  Bidi: ({ children }: { children: React.ReactNode }) => <bdi>{children}</bdi>,
  richMessage: (message: string) => message,
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
import { USER_PROFILE_GROUPS, type UserProfileSection } from './user-profile/model';

function openRow(section: UserProfileSection) {
  const heading = screen.getByRole('heading', { level: 2, name: `userProfile.${section === 'danger' ? 'delete' : section}.title` });
  fireEvent.click(within(heading.closest('section')!).getByRole('button', { expanded: false }));
}


describe('UserProfile', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.clearAllMocks();
    mocks.user.name = 'Mona';
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
      privacy: undefined,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('deep-links between account sections and submits profile changes', async () => {
    render(<UserProfile />);

    fireEvent.click(screen.getByRole('link', { name: 'userProfile.group.security' }));
    expect(window.location.hash).toBe('#authowl-profile-password');
    fireEvent.click(screen.getByRole('link', { name: 'userProfile.nav.profile' }));
    expect(window.location.hash).toBe('#authowl-profile-profile');
    expect(screen.getByRole('heading', { name: 'userProfile.email.title' })).toBeTruthy();

    openRow('profile');
    fireEvent.change(screen.getByLabelText('signUp.nameLabel'), { target: { value: 'Mona Ali' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.save' }));

    await waitFor(() => expect(mocks.account.updateProfile).toHaveBeenCalledWith({
      name: 'Mona Ali',
      image: null,
    }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it.each(USER_PROFILE_GROUPS.flatMap((group) => group.sections.map((section) => ({ group: group.id, section }))))(
    'opens the old $section hash in $group and focuses its heading', async ({ group, section }) => {
      mocks.user.twoFactorEnabled = true;
      // The privacy center itself stays lazy until its row is opened.
      Object.assign(mocks.config, { privacy: {} });
      window.history.replaceState(null, '', `#authowl-profile-${section}`);
      const { container } = render(<UserProfile />);
      await waitFor(() => {
        expect(container.querySelector('[data-group]')?.getAttribute('data-group')).toBe(group);
        expect(document.activeElement?.closest('[data-profile-section]')?.getAttribute('data-profile-section')).toBe(section);
      });
      expect(window.location.hash).toBe(`#authowl-profile-${section}`);
      expect(container.querySelectorAll('nav a[aria-current="page"]')).toHaveLength(1);
    },
  );

  it('handles hashchange within a group without remounting an open workflow', async () => {
    render(<UserProfile />);
    openRow('profile');
    const name = screen.getByLabelText('signUp.nameLabel');
    fireEvent.change(name, { target: { value: 'Draft name' } });
    window.history.replaceState(null, '', '#authowl-profile-email');
    fireEvent(window, new HashChangeEvent('hashchange'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'userProfile.email.title' })));
    expect(screen.getByLabelText('signUp.nameLabel')).toBe(name);
    expect(name).toHaveProperty('value', 'Draft name');
  });

  it('opens initial requests, then collapses and focuses later controlled changes', async () => {
    const { rerender } = render(<UserProfile section="email" />);
    expect(screen.getByLabelText('userProfile.email.newLabel')).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'userProfile.email.title' }));
    rerender(<UserProfile section="password" />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'userProfile.password.title' })));
    expect(screen.queryByLabelText('userProfile.password.currentLabel')).toBeNull();
    rerender(<UserProfile section="mfa" />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'userProfile.mfa.title' })));
    expect(within(screen.getByRole('heading', { name: 'userProfile.mfa.title' }).closest('section')!).getByRole('button', { expanded: false })).toBeTruthy();
  });

  it('does not reapply an old hash when enrollment adds recovery', () => {
    window.history.replaceState(null, '', '#authowl-profile-email');
    const { container, rerender } = render(<UserProfile />);
    fireEvent.click(screen.getByRole('link', { name: 'userProfile.group.security' }));
    // The host restores an old URL without dispatching hashchange.
    window.history.replaceState(null, '', '#authowl-profile-email');
    mocks.user.twoFactorEnabled = true;
    rerender(<UserProfile />);
    expect(container.querySelector('[data-group]')?.getAttribute('data-group')).toBe('security');
    expect(screen.getByRole('heading', { name: 'userProfile.recovery.title' })).toBeTruthy();
  });

  it('uses one section title and one modal h1, and mounts privacy only while open', () => {
    Object.assign(mocks.config, { privacy: {}, accountDeletion: false });
    const { container } = render(<UserProfile mode="modal" section="privacy" onClose={() => {}} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'privacy.title' })).toHaveLength(1);
    expect(screen.getByText('userProfile.group.privacy.description')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'userProfile.delete.title' })).toBeNull();
    expect(screen.getByTestId('privacy-center')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'privacy.title: common.close' }));
    expect(screen.queryByTestId('privacy-center')).toBeNull();
    expect(container.querySelectorAll('strong.ao-profile-row-title')).toHaveLength(0);
  });

  it('hides unavailable groups and navigates to the first available security section', () => {
    Object.assign(mocks.config, { socialProviders: [], privacy: undefined, accountDeletion: false, enabledMethods: [], twoFactor: false });
    render(<UserProfile />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    const security = screen.getByRole('link', { name: 'userProfile.group.security' });
    expect(security.getAttribute('href')).toBe('#authowl-profile-sessions');
    fireEvent.click(security);
    expect(window.location.hash).toBe('#authowl-profile-sessions');
    expect(screen.queryByRole('heading', { name: 'userProfile.password.title' })).toBeNull();
  });

  it('stays in Security when disabling MFA removes the active Recovery section', () => {
    mocks.user.twoFactorEnabled = true;
    const { container, rerender } = render(<UserProfile defaultSection="recovery" />);
    expect(container.querySelector('[data-section="recovery"]')).toBeTruthy();
    mocks.user.twoFactorEnabled = false;
    rerender(<UserProfile defaultSection="recovery" />);
    expect(container.querySelector('[data-group="security"][data-section="password"]')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'userProfile.recovery.title' })).toBeNull();
  });

  it('uses group order when the active security section becomes unavailable', () => {
    const { container, rerender } = render(<UserProfile section="password" />);
    mocks.config.enabledMethods = ['passkey'];
    rerender(<UserProfile section="password" />);
    expect(container.querySelector('[data-group="security"][data-section="passkeys"]')).toBeTruthy();
  });

  it('falls back within Privacy before considering the first group overall', () => {
    Object.assign(mocks.config, { privacy: {} });
    const { container, rerender } = render(<UserProfile section="privacy" />);
    Object.assign(mocks.config, { privacy: undefined });
    rerender(<UserProfile section="privacy" />);
    expect(container.querySelector('[data-group="privacy"][data-section="danger"]')).toBeTruthy();
    mocks.config.accountDeletion = false;
    rerender(<UserProfile section="privacy" />);
    expect(container.querySelector('[data-group="profile"][data-section="profile"]')).toBeTruthy();
  });

  it.each(['mfa', 'recovery'] as const)('disables %s row Close with a reason while fresh backup codes are displayed', async (section) => {
    mocks.user.twoFactorEnabled = section === 'recovery';
    mocks.mfa.enable.mockResolvedValueOnce({ data: {
      totpURI: 'otpauth://totp/AuthOwl?secret=JBSWY3DPEHPK3PXP',
      backupCodes: ['fresh-code'],
    }, error: null });
    render(<UserProfile defaultSection={section} />);
    const close = screen.getByRole('button', { name: `userProfile.${section}.title: common.close` });
    expect(close).toHaveProperty('disabled', false);
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: section === 'mfa' ? 'common.continue' : 'backupCodes.submit' }));
    const codes = await screen.findByTestId(section === 'mfa' ? 'mfa-backup-codes' : 'backup-codes-list');
    await waitFor(() => expect(close).toHaveProperty('disabled', true));
    const reasonId = close.getAttribute('aria-describedby')!.split(' ').at(-1)!;
    expect(document.getElementById(reasonId)?.textContent).toBe('mfa.enroll.backupCodesWarningStrong');
    fireEvent.click(close);
    expect(codes.isConnected).toBe(true);
    if (section === 'mfa') {
      mocks.mfa.verifyTotp.mockResolvedValueOnce({ data: { token: 'session-token' }, error: null });
      fireEvent.change(screen.getByLabelText('mfa.enroll.codeLabel'), { target: { value: '123456' } });
      await screen.findByTestId('mfa-enroll-done');
      await waitFor(() => expect(close).toHaveProperty('disabled', false));
      fireEvent.click(close);
      expect(screen.queryByTestId('mfa-enroll-done')).toBeNull();
    }
  });

  it('drops the parked weakening action and password when its row is collapsed', async () => {
    mocks.user.twoFactorEnabled = true;
    mocks.mfa.disable.mockResolvedValueOnce({ data: null, error: { code: 'SECOND_FACTOR_REQUIRED', status: 403 } });
    render(<UserProfile defaultSection="mfa" />);
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replace' }));
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replaceConfirm' }));
    await screen.findByLabelText('mfa.challenge.totpLabel');
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.title: common.close' }));
    expect(screen.queryByLabelText('common.passwordLabel')).toBeNull();
    openRow('mfa');
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replace' }));
    expect(screen.getByLabelText('common.passwordLabel')).toHaveProperty('value', '');
    expect(mocks.mfa.disable).toHaveBeenCalledOnce();
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

  it('keeps the phone sheet in the modal surface with trapped focus and Escape', () => {
    const onClose = vi.fn();
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      render(<UserProfile mode="modal" onClose={onClose} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog.classList.contains('ao-profile-modal')).toBe(true);
      expect(dialog.querySelector('.ao-profile-sheet-handle')?.getAttribute('aria-hidden')).toBe('true');
      const close = screen.getByRole('button', { name: 'userProfile.close' });
      close.focus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(within(screen.getByRole('heading', { name: 'userProfile.email.title' }).closest('section')!).getByRole('button'));
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(close);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
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

    it.each(['mfa', 'recovery'] as const)('never replays %s after closing during verification', async (section) => {
      mocks.user.twoFactorEnabled = true;
      const action = section === 'mfa' ? mocks.mfa.disable : mocks.mfa.regenerateBackupCodes;
      action.mockResolvedValueOnce(gated);
      let resolveVerification!: (value: unknown) => void;
      const verification = new Promise((resolve) => { resolveVerification = resolve; });
      mocks.mfa.verifyTotp.mockReturnValueOnce(verification);
      render(<UserProfile defaultSection={section} />);
      if (section === 'mfa') fireEvent.click(screen.getByRole('button', { name: 'userProfile.mfa.replace' }));
      fireEvent.change(screen.getByLabelText('common.passwordLabel'), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: section === 'mfa' ? 'userProfile.mfa.replaceConfirm' : 'backupCodes.submit' }));
      fireEvent.change(await screen.findByLabelText('mfa.challenge.totpLabel'), { target: { value: '123456' } });
      await waitFor(() => expect(mocks.mfa.verifyTotp).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole('button', { name: `userProfile.${section}.title: common.close` }));
      await act(async () => {
        resolveVerification({ data: { token: 'session-token' }, error: null });
        await verification;
      });
      expect(action).toHaveBeenCalledOnce();
      expect(mocks.refetch).not.toHaveBeenCalled();
    });

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

      // Wait for the prompt: the arms are mutually exclusive, so exactly one
      // `common.cancel` is on screen once it mounts.
      await screen.findByLabelText('mfa.challenge.totpLabel');
      fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));

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
      fireEvent.click(await screen.findByRole('button', { name: 'mfa.challenge.backupLabel' }));
      fireEvent.change(screen.getByLabelText('mfa.challenge.backupLabel'), {
        target: { value: 'backup-code-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.submit' }));

      await waitFor(() => expect(mocks.mfa.regenerateBackupCodes).toHaveBeenCalledTimes(2));
      expect(mocks.mfa.regenerateBackupCodes).toHaveBeenLastCalledWith({ password: 'password-1' });
      expect(await screen.findByText('code-9')).toBeTruthy();
    });

    it('clears the password when the backup-codes prompt is abandoned', async () => {
      mocks.user.twoFactorEnabled = true;
      mocks.mfa.regenerateBackupCodes.mockResolvedValueOnce(gated);
      render(<UserProfile defaultSection="recovery" />);

      fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
        target: { value: 'password-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'backupCodes.submit' }));

      fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }));

      // Backing out leaves no password behind in the form.
      expect(screen.getByLabelText('common.passwordLabel')).toHaveProperty('value', '');
      expect(mocks.mfa.regenerateBackupCodes).toHaveBeenCalledTimes(1);
    });
  });

  it('shows recovery only for an enrolled user and deletes only after email confirmation', async () => {
    mocks.user.twoFactorEnabled = true;
    const onDeleted = vi.fn();
    render(<UserProfile defaultSection="danger" onDeleted={onDeleted} />);

    expect(screen.getByRole('link', { name: 'userProfile.group.security' })).toBeTruthy();
    const confirmation = screen.getByRole('textbox');
    expect(screen.getByRole('button', { name: 'userProfile.delete.submit' })).toHaveProperty('disabled', true);
    fireEvent.change(confirmation, { target: { value: 'mona@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.delete.submit' }));

    await waitFor(() => expect(mocks.account.delete).toHaveBeenCalledOnce());
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it('omits the email line for phone-only identity', () => {
    mocks.user.email = null;
    mocks.user.name = '   ';
    mocks.user.phoneNumber = '01000000000';
    const { container } = render(<UserProfile />);
    expect(container.querySelector('.ao-profile-identity-copy small')).toBeNull();
    expect(container.querySelector('.ao-profile-avatar')?.textContent).toBe('○');
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

  it('opens the email row inline and preserves its verification request', async () => {
    render(<UserProfile defaultSection="email" />);
    expect(screen.getByLabelText('userProfile.email.newLabel')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('userProfile.email.newLabel'), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'userProfile.email.submit' }));
    await waitFor(() => expect(mocks.account.changeEmail).toHaveBeenCalledWith({
      newEmail: 'new@example.test', callbackURL: window.location.href,
    }));
    expect(screen.getByRole('status').textContent).toContain('userProfile.email.sent');
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

    expect(screen.getAllByText('mona@example.test').length).toBeGreaterThan(0);
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
    openRow('profile');

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
