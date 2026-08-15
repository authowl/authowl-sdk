// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    enabledMethods: ['email_otp', 'passkey'] as string[],
    socialProviders: [] as string[],
    legal: { required: false, version: 0 },
    mfaRequired: false,
    badge: false,
    signUp: { mode: 'open' },
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
    emailVerification: undefined as {
      required: boolean;
      method: 'link' | 'code';
    } | undefined,
    mfa: undefined as {
      totp: boolean;
      required: boolean;
      backupCodes: boolean;
    } | undefined,
  },
  signUp: vi.fn(async () => ({
    data: { sessionCreated: true },
    error: null,
  })),
  sendEmailOtp: vi.fn(async () => ({ data: { success: true }, error: null })),
  signInEmailOtp: vi.fn(async () => ({
    data: {},
    error: null,
  })),
  addPasskey: vi.fn(async () => ({
    data: { id: 'passkey-1', name: 'Device' },
    error: null,
  })),
  serverError: vi.fn((_error: unknown, fallback: string) => fallback),
  joinWaitlist: vi.fn(async () => ({ data: { accepted: true }, error: null })),
  sendVerificationCode: vi.fn(async () => ({ data: { success: true }, error: null })),
  verifyEmailCode: vi.fn(async () => ({ data: { status: true, user: {} }, error: null })),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({
    config: mocks.config,
    isLoading: false,
    isError: false,
  }),
  useSignUp: () => ({ signUp: mocks.signUp }),
  useWaitlist: () => ({ join: mocks.joinWaitlist }),
  useSignIn: () => ({
    sendEmailOtp: mocks.sendEmailOtp,
    signInEmailOtp: mocks.signInEmailOtp,
  }),
  usePasskeys: () => ({ addPasskey: mocks.addPasskey }),
  useEmailVerification: () => ({
    sendVerificationEmail: vi.fn(),
    sendVerificationCode: mocks.sendVerificationCode,
    verifyEmailCode: mocks.verifyEmailCode,
  }),
}));

vi.mock('../i18n', () => ({
  Bidi: ({ children }: { children: React.ReactNode }) => <bdi>{children}</bdi>,
  richMessage: (message: string) => message,
  useServerError: () => mocks.serverError,
  useT: () => (key: string) => key,
}));

import { SignUp } from './SignUp';

describe('SignUp passwordless passkey flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signUp.mockResolvedValue({
      data: { sessionCreated: true },
      error: null,
    });
    Object.assign(mocks.config, {
      enabledMethods: ['email_otp', 'passkey'],
      socialProviders: [],
      legal: { required: false, version: 0 },
      mfaRequired: false,
      badge: false,
      signUp: { mode: 'open' },
      authentication: undefined,
      userModel: undefined,
      emailVerification: undefined,
      mfa: undefined,
    });
  });

  afterEach(cleanup);

  it('proves the email, creates the passwordless session, and enrolls a passkey', async () => {
    const onSignedUp = vi.fn();
    render(<SignUp onSignedUp={onSignedUp} />);

    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'mona@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signUp.passwordlessSubmit' }));
    await waitFor(() =>
      expect(mocks.sendEmailOtp).toHaveBeenCalledWith({
        email: 'mona@example.test',
        type: 'sign-in',
      }, undefined),
    );

    const codeStep = await screen.findByTestId('emailotp-code');
    fireEvent.change(codeStep.querySelector('input')!, {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'emailOtp.verifySubmit' }));
    await waitFor(() =>
      expect(mocks.signInEmailOtp).toHaveBeenCalledWith({
        email: 'mona@example.test',
        otp: '123456',
      }),
    );

    expect(await screen.findByTestId('signup-passkey-completion')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'signUp.passkeySubmit' }));
    await waitFor(() => expect(mocks.addPasskey).toHaveBeenCalledTimes(1));
    expect(onSignedUp).toHaveBeenCalledTimes(1);
  });

  it('offers the same passkey completion after password registration', async () => {
    mocks.config.enabledMethods = ['password', 'passkey'];
    render(<SignUp />);

    fireEvent.change(screen.getByLabelText('signUp.nameLabel'), {
      target: { value: 'Mona Hassan' },
    });
    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'mona@example.test' },
    });
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signUp.submit' }));

    await waitFor(() =>
      expect(mocks.signUp).toHaveBeenCalledWith({
        email: 'mona@example.test',
        password: 'correct horse battery staple',
        name: 'Mona Hassan',
        callbackURL: undefined,
        consentVersion: undefined,
      }, undefined),
    );
    expect(await screen.findByTestId('signup-passkey-completion')).toBeTruthy();
  });

  it('shows verification pending when signup succeeds without creating a session', async () => {
    mocks.config.enabledMethods = ['password'];
    mocks.signUp.mockResolvedValue({
      data: { sessionCreated: false },
      error: null,
    });
    render(<SignUp />);

    fireEvent.change(screen.getByLabelText('signUp.nameLabel'), {
      target: { value: 'Mona Hassan' },
    });
    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'verify@example.test' },
    });
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signUp.submit' }));

    expect(await screen.findByTestId('signup-verify-pending')).toBeTruthy();
  });

  it('lets the user finish when the passkey ceremony is skipped', async () => {
    const onSignedUp = vi.fn();
    render(<SignUp onSignedUp={onSignedUp} />);
    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'skip@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signUp.passwordlessSubmit' }));
    await screen.findByTestId('emailotp-code');
    const codeStep = screen.getByTestId('emailotp-code');
    fireEvent.change(codeStep.querySelector('input')!, {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'emailOtp.verifySubmit' }));
    await screen.findByTestId('signup-passkey-completion');

    fireEvent.click(screen.getByRole('button', { name: 'signUp.passkeySkip' }));
    expect(mocks.addPasskey).not.toHaveBeenCalled();
    expect(onSignedUp).toHaveBeenCalledTimes(1);
  });

  it('does not offer passwordless account creation under legal or required-MFA gates', () => {
    mocks.config.legal = { required: true, version: 1 };
    const { rerender } = render(<SignUp />);
    expect(screen.queryByTestId('signup-emailotp-request')).toBeNull();

    mocks.config.legal = { required: false, version: 0 };
    mocks.config.mfaRequired = true;
    rerender(<SignUp />);
    expect(screen.queryByTestId('signup-emailotp-request')).toBeNull();
  });

  it('keeps branded legal consent beside the submit action', () => {
    Object.assign(mocks.config, {
      enabledMethods: ['password'],
      legal: {
        required: true,
        version: 7,
        termsUrl: 'https://example.test/terms',
        privacyUrl: 'https://example.test/privacy',
      },
    });
    render(<SignUp />);

    const form = screen.getByTestId('signup-form').querySelector('form');
    const consent = screen.getByTestId('signup-consent');
    const checkbox = consent.querySelector('input[type="checkbox"]');
    const submit = screen.getByRole('button', { name: 'signUp.submit' });

    expect(form).not.toBeNull();
    expect(consent.parentElement).toBe(form);
    expect(checkbox?.classList.contains('ba-checkbox')).toBe(true);
    expect(consent.querySelector('.ba-checkbox-visual')).not.toBeNull();
    expect(consent.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('replaces every account-creation method with waitlist enrollment', async () => {
    mocks.config.signUp = { mode: 'waitlist' };
    render(<SignUp />);

    expect(screen.queryByTestId('signup-form')).toBeNull();
    expect(screen.getByTestId('waitlist-form')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'wait@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'waitlist.submit' }));

    await waitFor(() => expect(mocks.joinWaitlist).toHaveBeenCalledWith(
      { email: 'wait@example.test' },
      undefined,
    ));
    expect(await screen.findByTestId('waitlist-accepted')).toBeTruthy();
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.sendEmailOtp).not.toHaveBeenCalled();
  });

  it('collects only the username and structured names enabled by project policy', async () => {
    Object.assign(mocks.config, {
      enabledMethods: ['password', 'passkey'],
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true },
        passkey: { signIn: true, add: false },
        username: { collectOnSignUp: true, signIn: true },
      },
      userModel: {
        requireEmail: true,
        firstLastName: true,
        emailChange: false,
        accountDeletion: false,
      },
    });
    render(<SignUp />);

    fireEvent.change(screen.getByLabelText('signUp.firstNameLabel'), {
      target: { value: 'Mona' },
    });
    fireEvent.change(screen.getByLabelText('signUp.lastNameLabel'), {
      target: { value: 'Ali' },
    });
    fireEvent.change(screen.getByLabelText('common.usernameLabel'), {
      target: { value: 'Mona_1' },
    });
    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'mona@example.test' },
    });
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signUp.submit' }));

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'mona@example.test',
      password: 'correct horse battery staple',
      name: 'Mona Ali',
      username: 'Mona_1',
      firstName: 'Mona',
      lastName: 'Ali',
      callbackURL: undefined,
      consentVersion: undefined,
    }, undefined));
    expect(screen.queryByTestId('signup-passkey-completion')).toBeNull();
  });

  it('completes required code verification without exposing code sign-in', async () => {
    Object.assign(mocks.config, {
      enabledMethods: ['password'],
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true },
        passkey: { signIn: false, add: false },
        username: { collectOnSignUp: false, signIn: false },
      },
      emailVerification: { required: true, method: 'code' },
    });
    mocks.signUp.mockResolvedValueOnce({
      data: { sessionCreated: false },
      error: null,
    });
    render(<SignUp />);

    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'verify@example.test' },
    });
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signUp.submit' }));

    const pending = await screen.findByTestId('verify-code-pending');
    fireEvent.change(screen.getByLabelText('verifyPending.codeLabel'), {
      target: { value: '123456' },
    });
    fireEvent.submit(pending);

    await waitFor(() => expect(mocks.verifyEmailCode).toHaveBeenCalledWith({
      email: 'verify@example.test',
      otp: '123456',
    }));
    expect(await screen.findByTestId('verify-code-success')).toBeTruthy();
  });
});
