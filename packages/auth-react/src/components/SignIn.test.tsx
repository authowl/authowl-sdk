// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    enabledMethods: ['sso'] as string[],
    socialProviders: [] as string[],
    sso: true,
    badge: false,
    authentication: undefined as {
      email: { signUp: boolean; signIn: Array<'password' | 'magic_link' | 'email_otp'> };
      phone: { signUp: boolean; signIn: boolean };
      password: { signUp: boolean; add: boolean };
      passkey: { signIn: boolean; add: boolean };
      username: { collectOnSignUp: boolean; signIn: boolean };
    } | undefined,
  },
  signInUsername: vi.fn(async () => ({
    data: { redirect: false, user: {} },
    error: null,
  })),
  signInSso: vi.fn(
    async (): Promise<{
      data: { redirect: boolean; url: string } | null;
      error: { status: number } | null;
    }> => ({ data: { redirect: true, url: 'https://idp.test/auth' }, error: null }),
  ),
  serverError: vi.fn((_error: unknown, fallback: string) => fallback),
  configError: false,
  retryPublicConfig: vi.fn(),
  needsMfaEnrollment: false,
  // What the uncached confirmation read returns. `pendingMfaEnrollment: true`
  // is the genuine required-MFA hold; false is the stale-cookie case.
  getSession: vi.fn(
    async (): Promise<{
      data: { session: { pendingMfaEnrollment: boolean } } | null;
      error: { status: number } | null;
    }> => ({ data: { session: { pendingMfaEnrollment: true } }, error: null }),
  ),
}));

vi.mock('../hooks', () => ({
  useAuthClient: () => ({
    sessionStore: { subscribe: vi.fn(() => () => {}), getSnapshot: vi.fn() },
    getSession: mocks.getSession,
  }),
  useSession: () => ({ refetch: vi.fn() }),
  useUser: () => ({ needsMfaEnrollment: mocks.needsMfaEnrollment }),
  usePublicConfig: () => ({
    config: mocks.config,
    isLoading: false,
    isError: mocks.configError,
    retry: mocks.retryPublicConfig,
  }),
  useSignIn: () => ({
    signIn: vi.fn(),
    signInUsername: mocks.signInUsername,
    signInMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    signInEmailOtp: vi.fn(),
    signInSso: mocks.signInSso,
  }),
}));

vi.mock('../i18n', () => ({
  useServerError: () => mocks.serverError,
  useT: () => (key: string) => key,
}));

// The SSO submit does not go through the human-challenge or passkey autofill
// paths; stub them so the component renders without provider context.
vi.mock('./AuthChallenge', () => ({
  AUTH_CHALLENGE_ACTIONS: { signIn: 'sign-in', passwordless: 'passwordless' },
  useAuthChallenge: () => ({ run: (_a: unknown, fn: (o?: unknown) => unknown) => fn(), control: null, configPending: false }),
}));
vi.mock('./passkey-autofill', () => ({ usePasskeyAutofill: () => undefined }));
vi.mock('./finish-sign-in', () => ({ finishSignIn: vi.fn() }));
vi.mock('./AuthOwlBadge', () => ({ AuthOwlBadge: () => null }));
vi.mock('./MFAEnrollment', () => ({
  MFAEnrollment: () => <div data-testid="mfa-enrollment" />,
}));

import { SignIn } from './SignIn';

describe('SignIn under required MFA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configError = false;
    mocks.needsMfaEnrollment = false;
    mocks.getSession.mockResolvedValue({
      data: { session: { pendingMfaEnrollment: true } },
      error: null,
    });
    Object.assign(mocks.config, {
      enabledMethods: ['password'],
      socialProviders: [],
      sso: false,
      badge: false,
      authentication: undefined,
    });
  });

  afterEach(cleanup);

  it('refuses to invent a password form when public config is unavailable', () => {
    mocks.configError = true;
    render(<SignIn />);

    expect(screen.getByTestId('authowl-config-error')).toBeTruthy();
    expect(screen.queryByTestId('signin-form')).toBeNull();
    expect(screen.queryByLabelText('common.passwordLabel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'publicConfig.retry' }));
    expect(mocks.retryPublicConfig).toHaveBeenCalledOnce();
  });

  // The lockout this branch exists to end: on a project with "Require MFA for
  // everyone" the sign-in SUCCEEDS but the session is held at enrolment, which
  // reads as signed out - so <SignedOut> keeps <SignIn/> mounted and the user
  // sees the form again, in every browser. Without the enrolment branch the
  // assertion below finds the sign-in form instead.
  it('finishes enrolment in place instead of re-rendering the sign-in form', async () => {
    mocks.needsMfaEnrollment = true;
    render(<SignIn />);

    await waitFor(() => {
      expect(screen.getByTestId('signin-mfa-enrolment')).toBeTruthy();
    });
    expect(screen.getByTestId('mfa-enrollment')).toBeTruthy();
    expect(screen.queryByTestId('signin-form')).toBeNull();
  });

  it('does not show enrolment for a stale pending flag another device already cleared', async () => {
    mocks.needsMfaEnrollment = true;
    mocks.getSession.mockResolvedValue({
      data: { session: { pendingMfaEnrollment: false } },
      error: null,
    });
    render(<SignIn />);

    // Re-running enrolment would regenerate a live TOTP secret, so a cached
    // true is never trusted without the uncached read agreeing.
    await waitFor(() => {
      expect(mocks.getSession).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('mfa-enrollment')).toBeNull();
  });

  // A sign-in form must never be replaced by an enrolment screen it cannot
  // leave. When the authoritative read fails the answer is unknown, and blocking
  // authentication is the worse mistake - the hold is enforced server-side
  // regardless, so showing the form grants nothing. The operator hit the
  // opposite behaviour on their own dashboard and could not sign in at all.
  it('shows the sign-in form, not enrolment, when the confirmation read errors', async () => {
    mocks.needsMfaEnrollment = true;
    mocks.getSession.mockResolvedValue({ data: null, error: { status: 500 } });
    render(<SignIn />);

    await waitFor(() => {
      expect(mocks.getSession).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('mfa-enrollment')).toBeNull();
  });

  it('still shows enrolment when the read CONFIRMS the session is held', async () => {
    mocks.needsMfaEnrollment = true;
    mocks.getSession.mockResolvedValue({
      data: { session: { pendingMfaEnrollment: true } },
      error: null,
    });
    render(<SignIn />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-enrollment')).toBeTruthy();
    });
  });

  it('leaves an ordinary sign-in untouched', () => {
    render(<SignIn />);
    expect(screen.queryByTestId('signin-mfa-enrolment')).toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});

describe('SignIn "Continue with SSO"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.config, {
      enabledMethods: ['sso'],
      socialProviders: [],
      sso: true,
      badge: false,
      authentication: undefined,
    });
  });

  afterEach(cleanup);

  it('folds SSO into the shared email form and posts /sign-in/sso with a required callbackURL', async () => {
    render(<SignIn />);

    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'user@acme.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sso.continueWith' }));

    await waitFor(() =>
      expect(mocks.signInSso).toHaveBeenCalledWith({
        email: 'user@acme.test',
        callbackURL: window.location.href,
      }),
    );
  });

  it('does not render a second email input when SSO is combined with password', () => {
    Object.assign(mocks.config, { enabledMethods: ['password', 'sso'] });
    render(<SignIn />);

    // One shared email field; SSO is an outlined alternate button.
    expect(screen.getAllByLabelText('common.emailLabel')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'sso.continueWith' })).toBeDefined();
  });

  it('render-gates SSO off when the project has not enabled the sso method', () => {
    Object.assign(mocks.config, { enabledMethods: ['password'] });
    render(<SignIn />);

    // Password-only plan: the "Continue with SSO" control must be absent.
    expect(screen.queryByRole('button', { name: 'sso.continueWith' })).toBeNull();
  });

  it('keeps the SSO button busy (spinner + aria-busy) after a successful redirect start', async () => {
    // Regression for the "flash back to idle" bug: signInSso resolves successfully
    // and the browser navigates to the IdP, so the spinner must PERSIST (keepPendingOnSuccess)
    // rather than reset in `finally`.
    const { container } = render(<SignIn />);

    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'user@acme.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sso.continueWith' }));

    await waitFor(() => expect(mocks.signInSso).toHaveBeenCalled());
    // Busy state holds: spinner present, aria-busy set, label swapped to "Redirecting…".
    await waitFor(() => expect(container.querySelector('.ba-spinner')).not.toBeNull());
    const button = screen.getByRole('button', { name: 'sso.redirecting' });
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('spins only the pressed button, not the idle alternates', async () => {
    // password + sso: pressing SSO must busy ONLY the SSO alternate (inFlight targeting).
    Object.assign(mocks.config, { enabledMethods: ['password', 'sso'] });
    const { container } = render(<SignIn />);

    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'user@acme.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sso.continueWith' }));

    await waitFor(() => expect(mocks.signInSso).toHaveBeenCalled());
    // Exactly one spinner (the SSO button); the password submit stays idle.
    await waitFor(() => expect(container.querySelectorAll('.ba-spinner')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'signIn.submit' }).getAttribute('aria-busy')).toBeNull();
  });

  it('maps a bare 404 from the SSO endpoint to the "no connection" message', async () => {
    // A bare 404 = "no SSO connection for that domain"; doSso's mapError turns it
    // into sso.error.notFound (Decision 1's client-side UX join).
    mocks.signInSso.mockResolvedValueOnce({ data: null, error: { status: 404 } });
    render(<SignIn />);

    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'user@acme.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sso.continueWith' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('sso.error.notFound');
  });

  it('offers an explicit username mode and routes it to username sign-in', async () => {
    mocks.config.enabledMethods = ['password'];
    mocks.config.authentication = {
      email: { signUp: true, signIn: ['password'] },
      phone: { signUp: false, signIn: false },
      password: { signUp: true, add: true },
      passkey: { signIn: false, add: false },
      username: { collectOnSignUp: true, signIn: true },
    };
    render(<SignIn />);

    fireEvent.click(screen.getByRole('button', { name: 'signIn.useUsername' }));
    fireEvent.change(screen.getByLabelText('common.usernameLabel'), {
      target: { value: 'Mona_1' },
    });
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), {
      target: { value: 'password-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signIn.submit' }));

    await waitFor(() => expect(mocks.signInUsername).toHaveBeenCalledWith(
      { username: 'Mona_1', password: 'password-1' },
      undefined,
    ));
  });
});
