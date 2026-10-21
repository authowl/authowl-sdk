// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as methodHints from '../last-used-method';
import { uninstrumentedUserEvent as userEvent } from 'storybook/test';

const mocks = vi.hoisted(() => ({
  pendingMfaEnrollment: false,
  needsMfaEnrollment: false,
  sessionListeners: new Set<() => void>(),
  refetch: vi.fn(() => {
    mocks.pendingMfaEnrollment = false;
    mocks.needsMfaEnrollment = false;
    for (const listener of mocks.sessionListeners) listener();
  }),
  client: {
    handoff: undefined as Promise<boolean> | undefined,
    sessionStore: {
      subscribe: (listener: () => void) => {
        mocks.sessionListeners.add(listener);
        return () => { mocks.sessionListeners.delete(listener); };
      },
      getSnapshot: () => ({ data: { user: { id: 'user_1' }, session: { id: 'session_1', pendingMfaEnrollment: mocks.pendingMfaEnrollment } } }),
    },
  },
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
  signInSocial: vi.fn(async () => ({ data: { redirect: true }, error: null })),
  signIn: vi.fn<() => Promise<{ data: { twoFactorRedirect?: boolean } | null; error: null }>>(async () => ({ data: {}, error: null })),
  signInMagicLink: vi.fn(async () => ({ data: null, error: null })),
  signInPasskey: vi.fn<() => Promise<{ data: object | null; error: { code: string } | null }>>(async () => ({ data: {}, error: null })),
  serverError: vi.fn((_error: unknown, fallback: string) => fallback),
  configError: false,
  configLoading: false,
  retryPublicConfig: vi.fn(),
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
    ...mocks.client,
    getSession: mocks.getSession,
  }),
  useSession: () => ({ refetch: mocks.refetch }),
  useUser: () => ({ needsMfaEnrollment: mocks.needsMfaEnrollment }),
  usePublicConfig: () => ({
    config: mocks.config,
    isLoading: mocks.configLoading,
    isError: mocks.configError,
    retry: mocks.retryPublicConfig,
  }),
  useSignIn: () => ({
    signInSocial: mocks.signInSocial,
    signIn: mocks.signIn,
    signInUsername: mocks.signInUsername,
    signInMagicLink: mocks.signInMagicLink,
    signInPasskey: mocks.signInPasskey,
    sendEmailOtp: vi.fn(),
    signInEmailOtp: vi.fn(),
    signInSso: mocks.signInSso,
  }),
  useMFA: () => ({ verifyTotp: vi.fn(), verifyBackupCode: vi.fn(), sendOtp: vi.fn(), verifyOtp: vi.fn() }),
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
  MFAEnrollment: ({ onEnrolled }: { onEnrolled: () => void }) => <button data-testid="mfa-enrollment" onClick={onEnrolled}>Enroll</button>,
}));

import { SignIn } from './SignIn';
import { finishSignIn } from './finish-sign-in';

describe('SignIn under required MFA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(finishSignIn).mockImplementation(async () => undefined);
    mocks.client.handoff = undefined;
    mocks.pendingMfaEnrollment = false;
    mocks.needsMfaEnrollment = false;
    mocks.sessionListeners.clear();
    mocks.configError = false;
    mocks.configLoading = false;
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

  it('returns social sign-in to the form before navigating to redirectTo', async () => {
    mocks.config.socialProviders = ['google'];
    render(<SignIn redirectTo="/dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: 'social.continueWith' }));
    await waitFor(() => expect(mocks.signInSocial).toHaveBeenCalledWith({
      provider: 'google', callbackURL: window.location.href, errorCallbackURL: window.location.href,
    }));
  });

  it('navigates to redirectTo only after a redeemed handoff completes', async () => {
    let redeem!: (value: boolean) => void;
    mocks.client.handoff = new Promise<boolean>((resolve) => { redeem = resolve; });
    const assign = vi.fn();
    const originalWindow = window;
    vi.stubGlobal('window', { ...originalWindow, document: originalWindow.document, location: { ...originalWindow.location, assign } });
    const onCompleted = vi.fn();
    try {
      const actual = await vi.importActual<{ finishSignIn: typeof finishSignIn }>('./finish-sign-in');
      vi.mocked(finishSignIn).mockImplementation(actual.finishSignIn);
      const view = render(<React.StrictMode><SignIn redirectTo="/dashboard" onSignedIn={onCompleted} /></React.StrictMode>);
      expect(assign).not.toHaveBeenCalled();
      expect(onCompleted).not.toHaveBeenCalled();
      redeem(true);
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard'));
      expect(onCompleted).toHaveBeenCalledOnce();
      expect(assign).toHaveBeenCalledOnce();
      view.unmount();
      render(<SignIn redirectTo="/dashboard" onSignedIn={onCompleted} />);
      await Promise.resolve();
      expect(onCompleted).toHaveBeenCalledOnce();
      expect(assign).toHaveBeenCalledOnce();
    } finally {
      mocks.client.handoff = undefined;
      vi.unstubAllGlobals();
    }
  });

  it('completes a handoff once with the latest inline callback and redirect after rerenders', async () => {
    let redeem!: (value: boolean) => void;
    mocks.client.handoff = new Promise<boolean>((resolve) => { redeem = resolve; });
    const assign = vi.fn();
    const originalWindow = window;
    vi.stubGlobal('window', { ...originalWindow, document: originalWindow.document, location: { ...originalWindow.location, assign } });
    const onCompleted = vi.fn();
    function Page({ version }: { version: number }) {
      return <SignIn redirectTo={`/dashboard/${version}`} onSignedIn={() => onCompleted(version)} />;
    }
    try {
      const actual = await vi.importActual<{ finishSignIn: typeof finishSignIn }>('./finish-sign-in');
      vi.mocked(finishSignIn).mockImplementation(actual.finishSignIn);
      const view = render(<React.StrictMode><Page version={1} /></React.StrictMode>);
      view.rerender(<React.StrictMode><Page version={2} /></React.StrictMode>);
      view.rerender(<React.StrictMode><Page version={3} /></React.StrictMode>);
      expect(onCompleted).not.toHaveBeenCalled();

      redeem(true);
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard/3'));
      expect(onCompleted).toHaveBeenCalledExactlyOnceWith(3);
      expect(finishSignIn).toHaveBeenCalledOnce();

      view.rerender(<React.StrictMode><Page version={4} /></React.StrictMode>);
      await Promise.resolve();
      expect(onCompleted).toHaveBeenCalledOnce();
      expect(assign).toHaveBeenCalledOnce();
    } finally {
      mocks.client.handoff = undefined;
      vi.unstubAllGlobals();
    }
  });

  it('keeps the form usable with an error when handoff projection fails', async () => {
    mocks.client.handoff = Promise.resolve(false);
    const completed = vi.fn();
    render(<SignIn redirectTo="/dashboard" onSignedIn={completed} />);
    await waitFor(() => expect(screen.getByText('signIn.error.failed')).toBeTruthy());
    expect(screen.getByLabelText('common.passwordLabel')).toBeTruthy();
    expect(completed).not.toHaveBeenCalled();
  });

  it('finishes a redeemed handoff after required MFA enrollment, once', async () => {
    mocks.pendingMfaEnrollment = true;
    mocks.needsMfaEnrollment = true;
    mocks.client.handoff = Promise.resolve(true);
    const assign = vi.fn();
    const originalWindow = window;
    vi.stubGlobal('window', { ...originalWindow, document: originalWindow.document, location: { ...originalWindow.location, assign } });
    const completed = vi.fn();
    try {
      const actual = await vi.importActual<{ finishSignIn: typeof finishSignIn }>('./finish-sign-in');
      vi.mocked(finishSignIn).mockImplementation(actual.finishSignIn);
      const view = render(<React.StrictMode><SignIn redirectTo="/dashboard" onSignedIn={completed} /></React.StrictMode>);
      await waitFor(() => expect(screen.getByTestId('mfa-enrollment')).toBeTruthy());
      expect(assign).not.toHaveBeenCalled();
      expect(completed).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('mfa-enrollment'));
      view.unmount();
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard'));
      expect(completed).toHaveBeenCalledOnce();
      render(<SignIn redirectTo="/dashboard" onSignedIn={completed} />);
      await Promise.resolve();
      expect(completed).toHaveBeenCalledOnce();
      expect(assign).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses to invent a password form when public config is unavailable', () => {
    mocks.configError = true;
    render(<SignIn />);

    expect(screen.getByTestId('authowl-config-error')).toBeTruthy();
    expect(screen.queryByTestId('signin-form')).toBeNull();
    expect(document.querySelector('input[type=password]')).toBeNull();

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

    // The wrapper renders while the session read confirms (a skeleton), then
    // swaps in the enrolment step; wait for the step itself, not the wrapper.
    expect(await screen.findByTestId('mfa-enrollment')).toBeTruthy();
    expect(screen.getByTestId('signin-mfa-enrolment')).toBeTruthy();
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

  it('returns SSO to the form before navigating to redirectTo', async () => {
    render(<SignIn redirectTo="/dashboard" />);

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

    // One shared email field stays outside the active panel.
    expect(screen.getAllByLabelText('common.emailLabel')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'signIn.tab.sso' }));
    expect(screen.getByRole('button', { name: 'sso.continueWith' })).toBeDefined();
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels).toHaveLength(1);
    for (const tab of screen.getAllByRole('tab')) expect(tab.getAttribute('aria-controls')).toBe(panels[0]!.id);
    expect(panels[0]!.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { selected: true }).id);
    expect(document.querySelector('input[type=password]')).toBeNull();
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

  it('locks method changes during a password request and marks only its submit busy', async () => {
    Object.assign(mocks.config, { enabledMethods: ['password', 'magic_link', 'sso'], socialProviders: ['google'] });
    let resolve!: (result: { data: object; error: null }) => void;
    mocks.signIn.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { container } = render(<SignIn />);
    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'user@acme.test' },
    });
    fireEvent.change(screen.getByLabelText('common.passwordLabel', { selector: 'input' }), { target: { value: 'password-1' } });
    const submit = screen.getByRole('button', { name: 'signIn.submit' });
    fireEvent.click(submit);
    const other = screen.getByRole('tab', { name: 'signIn.tab.emailLink' });
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect(other.hasAttribute('disabled')).toBe(false);
    fireEvent.click(other);
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('common.passwordLabel');
    expect([...container.querySelectorAll('[aria-busy="true"]')]).toEqual([submit]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'social.continueWith' }).disabled).toBe(true);
    expect(screen.queryByText('sso.redirecting')).toBeNull();
    resolve({ data: {}, error: null });
    await waitFor(() => expect(finishSignIn).toHaveBeenCalledOnce());
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(other.hasAttribute('aria-disabled')).toBe(false);
  });

  it('locks tabs and social during the primary passkey ceremony', async () => {
    Object.assign(mocks.config, { enabledMethods: ['password', 'passkey', 'sso'], socialProviders: ['google'] });
    let resolve!: (result: { data: object; error: null }) => void;
    mocks.signInPasskey.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { container } = render(<SignIn />);
    fireEvent.click(screen.getByRole('tab', { name: 'signIn.tab.passkey' }));
    const submit = screen.getByRole('button', { name: 'passkey.signInButton' });
    expect(submit.classList.contains('ao-button')).toBe(true);
    fireEvent.click(submit);
    expect(mocks.signInPasskey).toHaveBeenCalledOnce();
    const other = screen.getByRole('tab', { name: 'common.passwordLabel' });
    fireEvent.click(other);
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('signIn.tab.passkey');
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect([...container.querySelectorAll('[aria-busy="true"]')]).toEqual([submit]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'social.continueWith' }).disabled).toBe(true);
    expect(screen.queryByText('sso.redirecting')).toBeNull();
    resolve({ data: {}, error: null });
    await waitFor(() => expect(finishSignIn).toHaveBeenCalledOnce());
    await waitFor(() => expect(submit.hasAttribute('aria-busy')).toBe(false));
  });

  it('pins the submitted tab when a last-used hint arrives during the request', async () => {
    mocks.config.enabledMethods = ['password', 'magic_link'];
    const hint = vi.spyOn(methodHints, 'useLastUsedSignInMethod').mockReturnValue(null);
    let finish!: (result: { data: object; error: null }) => void;
    mocks.signIn.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    try {
      const view = render(<SignIn />);
      fireEvent.change(screen.getByLabelText('common.emailLabel'), { target: { value: 'user@acme.test' } });
      fireEvent.change(screen.getByLabelText('common.passwordLabel', { selector: 'input' }), { target: { value: 'password-1' } });
      fireEvent.click(screen.getByRole('button', { name: 'signIn.submit' }));
      hint.mockReturnValue('magic-link');
      view.rerender(<SignIn />);
      expect(screen.getByRole('tab', { selected: true }).textContent).toBe('common.passwordLabel');
      finish({ data: {}, error: null });
      await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'signIn.submit' }).disabled).toBe(false));
      expect(screen.getByRole('tab', { selected: true }).textContent).toBe('common.passwordLabel');
    } finally {
      hint.mockRestore();
    }
  });

  it('allows implicit Enter submission from an invalid partial email only on passkey', async () => {
    mocks.config.enabledMethods = ['password', 'passkey'];
    render(<SignIn />);
    const email = screen.getByLabelText<HTMLInputElement>('common.emailLabel');
    expect(email.form!.noValidate).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'signIn.tab.passkey' }));
    fireEvent.change(email, { target: { value: 'partial@' } });
    expect(email.checkValidity()).toBe(false);
    expect(email.form!.noValidate).toBe(true);
    email.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(mocks.signInPasskey).toHaveBeenCalledOnce());
  });

  it('locks every alternative during social sign-in and unlocks after a failure', async () => {
    mocks.config.socialProviders = ['google'];
    mocks.config.authentication = {
      email: { signUp: true, signIn: ['password', 'magic_link'] },
      phone: { signUp: true, signIn: true },
      password: { signUp: true, add: true },
      passkey: { signIn: true, add: true },
      username: { collectOnSignUp: true, signIn: true },
    };
    let reject!: (error: Error) => void;
    mocks.signInSocial.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const { container } = render(<SignIn resetPasswordUrl="/reset" />);
    const social = screen.getByRole('button', { name: 'social.continueWith' });
    fireEvent.click(social);
    expect([...container.querySelectorAll('[aria-busy="true"]')]).toEqual([social]);
    for (const name of ['signIn.submit', 'signIn.forgotLink', 'signIn.useUsername', 'phoneOtp.usePhone']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
    const other = screen.getByRole('tab', { name: 'signIn.tab.passkey' });
    fireEvent.click(other);
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('common.passwordLabel');
    reject(new Error('start failed'));
    await screen.findByText('social.error.startFailed');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'signIn.submit' }).disabled).toBe(false);
    expect(other.hasAttribute('aria-disabled')).toBe(false);
  });

  it.each(['cancelled', 'failed'] as const)('handles a %s passkey ceremony without finishing sign-in', async (outcome) => {
    mocks.config.enabledMethods = ['password', 'passkey'];
    mocks.signInPasskey.mockResolvedValueOnce({ data: null, error: outcome === 'failed' ? { code: 'X' } : null });
    render(<SignIn />);
    fireEvent.click(screen.getByRole('tab', { name: 'signIn.tab.passkey' }));
    fireEvent.click(screen.getByRole('button', { name: 'passkey.signInButton' }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'passkey.signInButton' }).disabled).toBe(false));
    expect(finishSignIn).not.toHaveBeenCalled();
    if (outcome === 'failed') expect(screen.getByRole('alert').textContent).toBe('passkey.error.signInFailed');
    else expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refocuses the remounted form after MFA confirmation clears', async () => {
    const view = render(<SignIn />);
    const previous = screen.getByTestId('signin-form');
    let confirm!: (value: Awaited<ReturnType<typeof mocks.getSession>>) => void;
    mocks.getSession.mockReturnValueOnce(new Promise((resolve) => { confirm = resolve; }));
    mocks.needsMfaEnrollment = true;
    view.rerender(<SignIn />);
    expect(screen.getByTestId('signin-mfa-enrolment').getAttribute('aria-busy')).toBe('true');
    expect(previous.isConnected).toBe(false);
    confirm({ data: { session: { pendingMfaEnrollment: false } }, error: null });
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
    view.rerender(<SignIn />);
    const form = screen.getByTestId('signin-form');
    expect(form).not.toBe(previous);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'signIn.title' }));
  });

  it('does not take focus when the form first appears after config loads', () => {
    mocks.config.enabledMethods = ['password', 'magic_link'];
    mocks.configLoading = true;
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    const view = render(<SignIn />);
    expect(screen.getByTestId('signin-loading')).toBeTruthy();
    mocks.configLoading = false;
    view.rerender(<SignIn />);
    expect(screen.getByTestId('signin-form')).toBeTruthy();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('focuses and announces magic-link confirmation, then restores its opener on Back', async () => {
    mocks.config.enabledMethods = ['password', 'magic_link'];
    render(<SignIn />);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('tab', { name: 'signIn.tab.emailLink' }));
    fireEvent.change(screen.getByLabelText('common.emailLabel'), { target: { value: 'user@acme.test' } });
    const submit = screen.getByRole('button', { name: 'magicLink.submit' });
    submit.focus();
    fireEvent.click(submit);
    const confirmation = await screen.findByTestId('signin-magic-sent');
    const heading = screen.getByRole('heading', { name: 'signIn.title' });
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    expect(heading.closest('[role=status]')).toBe(confirmation);
    fireEvent.click(screen.getByRole('button', { name: /forgotPassword.backToSignIn/ }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'magicLink.submit' }));
  });

  it('returns focus to the shared email after implicit email-link submission', async () => {
    mocks.config.enabledMethods = ['magic_link'];
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText('common.emailLabel'), 'user@acme.test{Enter}');
    await screen.findByTestId('signin-magic-sent');
    fireEvent.click(screen.getByRole('button', { name: /forgotPassword.backToSignIn/ }));
    expect(document.activeElement).toBe(screen.getByLabelText('common.emailLabel'));
  });

  it('remounts the MFA challenge shell with the entrance class and focuses its heading', async () => {
    mocks.config.enabledMethods = ['password'];
    mocks.signIn.mockResolvedValueOnce({ data: { twoFactorRedirect: true }, error: null });
    render(<SignIn />);
    const previous = screen.getByTestId('signin-form');
    fireEvent.change(screen.getByLabelText('common.emailLabel'), { target: { value: 'user@acme.test' } });
    fireEvent.change(screen.getByLabelText('common.passwordLabel'), { target: { value: 'password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'signIn.submit' }));
    const challenge = await screen.findByTestId('signin-mfa');
    expect(challenge).not.toBe(previous);
    expect(previous.isConnected).toBe(false);
    expect(challenge.classList.contains('ao-step')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'mfa.challenge.title' }));
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
