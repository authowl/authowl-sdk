// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { signUpEmail, sendOtp, signInEmailOtp, signInSocial, publicConfig } = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
  sendOtp: vi.fn(),
  signInEmailOtp: vi.fn(),
  signInSocial: vi.fn(),
  publicConfig: {
    value: {
      enabledMethods: ['password'],
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true, minLength: 8, maxLength: 128 },
        passkey: { signIn: false, add: false },
        username: { collectOnSignUp: false, signIn: false },
      },
      legal: { required: false, version: 0 },
    } as Record<string, unknown>,
  },
}));

vi.mock('../provider', () => ({
  useAuthOwlClient: () => ({
    signUp: { email: signUpEmail },
    emailOtp: { sendVerificationOtp: sendOtp },
    signIn: { emailOtp: signInEmailOtp, social: signInSocial },
  }),
  usePublicConfig: () => ({ data: publicConfig.value, isLoading: false, error: null }),
  useAuthOwlLocale: () => 'en',
}));

import { EmailOtpForm } from './EmailOtpForm';
import { SignUp } from './SignUp';
import { SocialButtons, type SocialProvider } from './SocialButtons';
import { createStyles, darkTheme, defaultTheme } from './theme';

const byId = (id: string) => screen.getByTestId(id) as HTMLElement;
const input = (id: string) => byId(id) as HTMLInputElement;
const button = (id: string) => byId(id) as HTMLButtonElement;
const type = (id: string, value: string) =>
  fireEvent.change(input(id), { target: { value } });

afterEach(cleanup);

describe('<SignUp />', () => {
  beforeEach(() => {
    signUpEmail.mockReset();
    publicConfig.value = {
      enabledMethods: ['password'],
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true, minLength: 8, maxLength: 128 },
        passkey: { signIn: false, add: false },
        username: { collectOnSignUp: false, signIn: false },
      },
      legal: { required: false, version: 0 },
    };
  });

  it('requires a display name, which the server does not accept as empty', () => {
    render(<SignUp />);
    type('authowl-signup-email', 'mona@example.test');
    type('authowl-signup-password', 'correct horse');
    expect(button('authowl-signup-submit').disabled).toBe(true);

    type('authowl-signup-name', 'Mona');
    expect(button('authowl-signup-submit').disabled).toBe(false);
  });

  it('joins first and last name into the display name the server requires', async () => {
    signUpEmail.mockResolvedValue({ data: { sessionCreated: true }, error: null });
    render(<SignUp structuredName />);
    type('authowl-signup-first-name', 'Mona');
    type('authowl-signup-last-name', 'Ali');
    type('authowl-signup-email', 'mona@example.test');
    type('authowl-signup-password', 'correct horse');
    fireEvent.click(button('authowl-signup-submit'));

    await waitFor(() => expect(signUpEmail).toHaveBeenCalledWith({
      email: 'mona@example.test',
      password: 'correct horse',
      name: 'Mona Ali',
      firstName: 'Mona',
      lastName: 'Ali',
    }));
  });

  it('reports whether a session was created, not merely that sign-up worked', async () => {
    // Verification-required projects return no session; the caller has to show
    // "check your email" rather than navigating into the app.
    signUpEmail.mockResolvedValue({ data: { sessionCreated: false }, error: null });
    const onSignedUp = vi.fn();
    render(<SignUp onSignedUp={onSignedUp} />);
    type('authowl-signup-name', 'Mona');
    type('authowl-signup-email', 'mona@example.test');
    type('authowl-signup-password', 'correct horse');
    fireEvent.click(button('authowl-signup-submit'));

    await waitFor(() => expect(onSignedUp).toHaveBeenCalledWith({ sessionCreated: false }));
  });

  it('collects and sends the project legal-consent version', async () => {
    publicConfig.value = {
      ...publicConfig.value,
      legal: {
        required: true,
        version: 7,
        termsUrl: 'https://example.test/terms',
        privacyUrl: 'https://example.test/privacy',
      },
    };
    signUpEmail.mockResolvedValue({ data: { sessionCreated: true }, error: null });
    render(<SignUp />);
    type('authowl-signup-name', 'Mona');
    type('authowl-signup-email', 'mona@example.test');
    type('authowl-signup-password', 'correct horse');

    expect(button('authowl-signup-submit').disabled).toBe(true);
    expect(byId('authowl-signup-consent-box')).toBeTruthy();
    expect(byId('authowl-signup-terms')).toBeTruthy();
    expect(byId('authowl-signup-privacy')).toBeTruthy();
    fireEvent.click(byId('authowl-signup-consent'));
    expect(button('authowl-signup-submit').disabled).toBe(false);
    fireEvent.click(button('authowl-signup-submit'));

    await waitFor(() => expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({
      consentVersion: 7,
    })));
  });

  it('renders exact privacy notices and sends explicit optional choices', async () => {
    publicConfig.value = {
      ...publicConfig.value,
      privacy: {
        notices: [{
          noticeId: '11111111-1111-4111-8111-111111111111',
          noticeVersionId: '22222222-2222-4222-8222-222222222222',
          code: 'signup_notice',
          version: 1,
          title: { en: 'Privacy at sign-up', ar: 'الخصوصية عند التسجيل' },
          body: { en: 'How this app uses your data.', ar: 'كيفية استخدام التطبيق لبياناتك.' },
          digest: { en: 'a'.repeat(64), ar: 'b'.repeat(64) },
          activityCodes: ['research'],
          purposeCodes: ['research'],
          effectiveFrom: '2026-08-27T10:00:00.000Z',
        }],
        consentPurposes: [{
          purposeId: '33333333-3333-4333-8333-333333333333',
          purposeVersionId: '44444444-4444-4444-8444-444444444444',
          code: 'research',
          version: 1,
          title: { en: 'Optional research', ar: 'أبحاث اختيارية' },
          description: { en: 'Help improve the app.', ar: 'المساعدة في تحسين التطبيق.' },
          digest: { en: 'c'.repeat(64), ar: 'd'.repeat(64) },
          activityCodes: ['research'],
          dataCategories: ['usage'],
        }],
      },
    };
    signUpEmail.mockResolvedValue({ data: { sessionCreated: true }, error: null });
    render(<SignUp />);
    expect(screen.getByText('How this app uses your data.')).toBeTruthy();
    fireEvent.click(byId('authowl-signup-purpose-research'));
    type('authowl-signup-name', 'Mona');
    type('authowl-signup-email', 'mona@example.test');
    type('authowl-signup-password', 'correct horse');
    fireEvent.click(button('authowl-signup-submit'));

    await waitFor(() => expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({
      privacyEvidence: {
        locale: 'en',
        correlationId: expect.any(String),
        noticeVersionIds: ['22222222-2222-4222-8222-222222222222'],
        consentDecisions: [expect.objectContaining({
          purposeCode: 'research',
          decision: 'granted',
        })],
      },
    })));
  });

  it('uses AuthOwl gold in both default themes', () => {
    for (const theme of [defaultTheme, darkTheme]) {
      const styles = createStyles(theme);
      expect(theme.accent).toBe('#F5B84C');
      expect(theme.accentText).toBe('#241703');
      expect(styles.consentBoxChecked.backgroundColor).toBe('#F5B84C');
      expect(styles.button.backgroundColor).toBe('#F5B84C');
    }
  });

  it('surfaces a failure without calling back', async () => {
    signUpEmail.mockResolvedValue({ data: null, error: { code: 'USER_ALREADY_EXISTS' } });
    const onSignedUp = vi.fn();
    render(<SignUp onSignedUp={onSignedUp} />);
    type('authowl-signup-name', 'Mona');
    type('authowl-signup-email', 'mona@example.test');
    type('authowl-signup-password', 'correct horse');
    fireEvent.click(button('authowl-signup-submit'));

    await waitFor(() => expect(screen.getByTestId('authowl-error')).toBeTruthy());
    expect(onSignedUp).not.toHaveBeenCalled();
  });
});

describe('<EmailOtpForm />', () => {
  beforeEach(() => {
    sendOtp.mockReset();
    signInEmailOtp.mockReset();
  });

  it('advances to the code stage only after the code is sent', async () => {
    sendOtp.mockResolvedValue({ data: { success: true }, error: null });
    render(<EmailOtpForm />);
    type('authowl-emailotp-email', 'mona@example.test');
    fireEvent.click(button('authowl-emailotp-request'));

    await waitFor(() => expect(screen.getByTestId('authowl-emailotp-code')).toBeTruthy());
    expect(sendOtp).toHaveBeenCalledWith({ email: 'mona@example.test', type: 'sign-in' });
  });

  it('stays on the email stage when sending fails', async () => {
    sendOtp.mockResolvedValue({ data: null, error: { code: 'RATE_LIMITED' } });
    render(<EmailOtpForm />);
    type('authowl-emailotp-email', 'mona@example.test');
    fireEvent.click(button('authowl-emailotp-request'));

    await waitFor(() => expect(screen.getByTestId('authowl-error')).toBeTruthy());
    expect(screen.queryByTestId('authowl-emailotp-code')).toBeNull();
  });

  it('verifies the code against the address it was sent to', async () => {
    sendOtp.mockResolvedValue({ data: { success: true }, error: null });
    signInEmailOtp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const onSignedIn = vi.fn();
    render(<EmailOtpForm onSignedIn={onSignedIn} />);
    type('authowl-emailotp-email', 'mona@example.test');
    fireEvent.click(button('authowl-emailotp-request'));

    await waitFor(() => expect(screen.getByTestId('authowl-emailotp-code')).toBeTruthy());
    type('authowl-emailotp-code', '123456');
    fireEvent.click(button('authowl-emailotp-verify'));

    await waitFor(() => expect(signInEmailOtp).toHaveBeenCalledWith({
      email: 'mona@example.test',
      otp: '123456',
    }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('discards a code minted for the previous address', async () => {
    sendOtp.mockResolvedValue({ data: { success: true }, error: null });
    render(<EmailOtpForm />);
    type('authowl-emailotp-email', 'mona@example.test');
    fireEvent.click(button('authowl-emailotp-request'));

    await waitFor(() => expect(screen.getByTestId('authowl-emailotp-code')).toBeTruthy());
    type('authowl-emailotp-code', '123456');
    fireEvent.click(byId('authowl-emailotp-change'));

    await waitFor(() => expect(screen.getByTestId('authowl-emailotp-email')).toBeTruthy());
    fireEvent.click(button('authowl-emailotp-request'));
    await waitFor(() => expect(screen.getByTestId('authowl-emailotp-code')).toBeTruthy());
    // Carrying the old code forward could only ever fail against a new address.
    expect(input('authowl-emailotp-code').value).toBe('');
  });
});

describe('<SocialButtons />', () => {
  beforeEach(() => signInSocial.mockReset());

  function provider(id: string, token: ProviderToken = { token: 'id-token' }): SocialProvider {
    return { id, label: id, getIdToken: vi.fn().mockResolvedValue(token) };
  }
  type ProviderToken = { token: string } | null;

  it('renders nothing when the app configured no providers', () => {
    render(<SocialButtons providers={[]} />);
    expect(screen.queryByTestId('authowl-social')).toBeNull();
  });

  it('exchanges the provider ID token for a session', async () => {
    signInSocial.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const onSignedIn = vi.fn();
    render(<SocialButtons providers={[provider('google')]} onSignedIn={onSignedIn} />);
    fireEvent.click(button('authowl-social-google'));

    await waitFor(() => expect(signInSocial).toHaveBeenCalledWith({
      provider: 'google',
      idToken: { token: 'id-token' },
    }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('treats a cancelled provider sheet as neither success nor failure', async () => {
    const onSignedIn = vi.fn();
    render(<SocialButtons providers={[provider('apple', null)]} onSignedIn={onSignedIn} />);
    fireEvent.click(button('authowl-social-apple'));

    await waitFor(() => expect(button('authowl-social-apple').disabled).toBe(false));
    expect(signInSocial).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.queryByTestId('authowl-social-error')).toBeNull();
  });

  it('locks the other providers while one flow is in progress', async () => {
    let release: (value: { token: string }) => void = () => {};
    const slow: SocialProvider = {
      id: 'google',
      label: 'Google',
      getIdToken: () => new Promise((resolve) => { release = resolve; }),
    };
    render(<SocialButtons providers={[slow, provider('apple')]} />);
    fireEvent.click(button('authowl-social-google'));

    // Two provider sheets at once would race to establish a session.
    await waitFor(() => expect(button('authowl-social-apple').disabled).toBe(true));
    release({ token: 'id-token' });
  });

  it('reports a rejected provider SDK without stranding the buttons', async () => {
    const failing: SocialProvider = {
      id: 'google',
      label: 'Google',
      getIdToken: () => Promise.reject(new Error('sdk unavailable')),
    };
    render(<SocialButtons providers={[failing]} />);
    fireEvent.click(button('authowl-social-google'));

    await waitFor(() => expect(screen.getByTestId('authowl-social-error')).toBeTruthy());
    expect(button('authowl-social-google').disabled).toBe(false);
  });
});
