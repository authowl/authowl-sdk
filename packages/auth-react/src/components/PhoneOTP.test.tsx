// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthActionResult, PhoneOtpChallengeData } from '@authowl/core';

// vi.mock factories are hoisted above const declarations, so the spies have to
// be created inside vi.hoisted to exist by the time a factory runs.
const {
  preparePhoneOtp,
  startPhoneOtp,
  verifyPhoneOtp,
  completePhoneOtp,
  createIdempotencyKey,
  finishSignIn,
  solvePhoneOtpChallenge,
} = vi.hoisted(() => ({
  preparePhoneOtp: vi.fn(),
  startPhoneOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
  completePhoneOtp: vi.fn(),
  createIdempotencyKey: vi.fn(() => 'idem-1'),
  finishSignIn: vi.fn(async () => undefined),
  solvePhoneOtpChallenge: vi.fn(),
}));

vi.mock('@authowl/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AKEDLY_PASSKEY_ALLOW:
    'publickey-credentials-get https://auth.akedly.io; '
    + 'publickey-credentials-create https://auth.akedly.io',
  HOSTED_PHONE_OTP_POLLING: { intervalMs: 1_000, maxAttempts: 20 },
  createIdempotencyKey,
  isAkedlyWidgetMessage: (event: MessageEvent, frame: HTMLIFrameElement | null) =>
    frame !== null
    && event.origin === 'https://auth.akedly.io'
    && event.source === frame.contentWindow,
  solvePhoneOtpChallenge,
  trustedAkedlyIframeUrl: (value: string) => {
    try {
      return new URL(value).origin === 'https://auth.akedly.io' ? value : null;
    } catch {
      return null;
    }
  },
}));
vi.mock('../hooks', () => ({
  useAuthClient: () => ({ sessionStore: { subscribe: () => () => {}, getSnapshot: () => null } }),
  usePublicConfig: () => ({
    config: { turnstileSiteKey: 'site-key', branding: { theme: 'light' }, legal: null },
    isLoading: false,
  }),
  useSignIn: () => ({
    preparePhoneOtp,
    startPhoneOtp,
    verifyPhoneOtp,
    completePhoneOtp,
  }),
}));
vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  Bidi: ({ children }: { children?: unknown }) => children,
  useServerError: () => (error: { message?: string } | null) => error?.message ?? null,
  richMessage: (key: string) => key,
}));
vi.mock('./Turnstile', () => ({ Turnstile: () => <div data-testid="turnstile" /> }));
vi.mock('./finish-sign-in', () => ({ finishSignIn }));

import { PhoneOTP } from './PhoneOTP';

/** A promise the test resolves by hand, so the pending window can be inspected. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

const sendButton = () =>
  screen.getByRole('button', { name: /phoneOtp.sendSubmit/i }) as HTMLButtonElement;

const shieldChallenge: PhoneOtpChallengeData = {
  kind: 'akedly_shield_v1_2',
  connectionId: 'connection-1',
  challenge: 'a'.repeat(64),
  difficulty: 4,
  challengeToken: 'signed.challenge.token',
  challengeRequired: true,
  turnstile: { required: false, siteKey: null },
};

const hostedChallenge = (passkeys: boolean): PhoneOtpChallengeData => ({
  kind: 'akedly_widget_v2',
  connectionId: 'connection-hosted',
  passkeys,
});

const hostedStart = (passkeys: boolean) => ({
  status: 'hosted' as const,
  attemptId: 'attempt-1',
  iframeUrl: 'https://auth.akedly.io/auth?attemptId=attempt-1',
  attemptToken: 't'.repeat(32),
  expiresAt: new Date(Date.now() + 5 * 60_000),
  passkeys,
});

async function renderHosted(passkeys: boolean) {
  preparePhoneOtp.mockResolvedValue({ data: hostedChallenge(passkeys), error: null });
  startPhoneOtp.mockResolvedValue({ data: hostedStart(passkeys), error: null });
  render(<PhoneOTP onSignedIn={vi.fn()} />);
  await waitFor(() => expect(sendButton().disabled).toBe(false));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '01000000000' } });
  fireEvent.click(sendButton());
  return waitFor(() => screen.getByTestId('phoneotp-hosted-frame') as HTMLIFrameElement);
}

describe('PhoneOTP challenge gating', () => {
  beforeEach(() => {
    preparePhoneOtp.mockReset();
    startPhoneOtp.mockReset();
    verifyPhoneOtp.mockReset();
    completePhoneOtp.mockReset();
    createIdempotencyKey.mockClear();
    createIdempotencyKey.mockReturnValue('idem-1');
    finishSignIn.mockClear();
    solvePhoneOtpChallenge.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps send disabled while the server has not said which challenge applies', async () => {
    // `guard === null` means UNKNOWN, not "no challenge required". Enabling the
    // button here would let a click through before any anti-abuse proof exists.
    const pendingPrepare = deferred<AuthActionResult<PhoneOtpChallengeData>>();
    preparePhoneOtp.mockReturnValue(pendingPrepare.promise);

    render(<PhoneOTP />);
    const button = await screen.findByRole('button', { name: /phoneOtp.sendSubmit/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    pendingPrepare.resolve({ data: shieldChallenge, error: null });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
  });

  it('recovers from a transient challenge lookup failure without a page reload', async () => {
    preparePhoneOtp.mockResolvedValueOnce({
      data: null,
      error: { message: 'unavailable' },
    }).mockResolvedValueOnce({ data: shieldChallenge, error: null });

    render(<PhoneOTP />);
    await waitFor(() => expect(screen.getByText('phoneOtp.error.humanCheck')).toBeTruthy());
    expect(sendButton().disabled).toBe(true);
    expect(startPhoneOtp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'phoneOtp.retryHumanCheck' }));
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    expect(preparePhoneOtp).toHaveBeenCalledTimes(2);
  });

  it('renders Turnstile only for the legacy route, never for a Shield route', async () => {
    preparePhoneOtp.mockResolvedValue({ data: shieldChallenge, error: null });

    render(<PhoneOTP />);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    expect(screen.queryByTestId('turnstile')).toBeNull();
  });

  it('requires a Turnstile token before enabling send on the legacy route', async () => {
    preparePhoneOtp.mockResolvedValue({
      data: { kind: 'authowl_turnstile' },
      error: null,
    });

    render(<PhoneOTP />);
    await waitFor(() => expect(screen.getByTestId('turnstile')).toBeTruthy());
    // No token has arrived from the widget yet, so send stays closed.
    expect(sendButton().disabled).toBe(true);
  });

  it('returns an enrolled MFA account to password sign-in instead of reporting an invalid code', async () => {
    const onMfaPasswordRequired = vi.fn();
    preparePhoneOtp.mockResolvedValue({ data: shieldChallenge, error: null });
    solvePhoneOtpChallenge.mockResolvedValue({ challengeToken: 'proof', nonce: 1 });
    startPhoneOtp.mockResolvedValue({ data: { status: 'pending' }, error: null });
    verifyPhoneOtp.mockResolvedValue({
      data: null,
      error: { code: 'TWO_FACTOR_REQUIRED', status: 403, message: 'Use password.' },
    });

    render(<PhoneOTP onMfaPasswordRequired={onMfaPasswordRequired} />);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '01000000000' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByTestId('phoneotp-code')).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '424242' } });
    fireEvent.click(screen.getByRole('button', { name: 'phoneOtp.verifySubmit' }));

    await waitFor(() => expect(onMfaPasswordRequired).toHaveBeenCalledTimes(1));
  });

  it.each([
    [true, 'publickey-credentials-get https://auth.akedly.io; publickey-credentials-create https://auth.akedly.io'],
    [false, null],
  ])('renders the trusted hosted iframe with passkeys=%s', async (passkeys, expectedAllow) => {
    const frame = await renderHosted(passkeys);

    expect(frame.src).toBe('https://auth.akedly.io/auth?attemptId=attempt-1');
    expect(frame.getAttribute('allow')).toBe(expectedAllow);
  });

  it('ignores hosted messages from a wrong origin or source window', async () => {
    const frame = await renderHosted(true);
    completePhoneOtp.mockResolvedValue({ data: { status: 'pending' }, error: null });
    vi.useFakeTimers();

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example.test',
      source: frame.contentWindow,
      data: { type: 'AUTH_SUCCESS' },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://auth.akedly.io',
      source: window,
      data: { type: 'AUTH_SUCCESS' },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(completePhoneOtp).not.toHaveBeenCalled();
  });

  it('finishes sign-in after Akedly success and hosted completion', async () => {
    const frame = await renderHosted(true);
    completePhoneOtp.mockResolvedValue({
      data: {
        status: true,
        sessionCreated: true,
        user: {
          id: 'phone-user',
          phoneNumber: '+201000000000',
          phoneNumberVerified: true,
        },
      },
      error: null,
    });
    vi.useFakeTimers();

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://auth.akedly.io',
      source: frame.contentWindow,
      data: { type: 'AUTH_SUCCESS', extra: 'tolerated' },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(completePhoneOtp).toHaveBeenCalledWith({
      phoneNumber: '01000000000',
      attemptId: 'attempt-1',
      attemptToken: 't'.repeat(32),
      consentVersion: undefined,
    });
    expect(finishSignIn).toHaveBeenCalledTimes(1);
  });

  it('keeps polling when onSignedIn changes after Akedly success', async () => {
    preparePhoneOtp.mockResolvedValue({ data: hostedChallenge(true), error: null });
    startPhoneOtp.mockResolvedValue({ data: hostedStart(true), error: null });
    completePhoneOtp.mockResolvedValue({
      data: {
        status: true,
        sessionCreated: true,
        user: {
          id: 'phone-user',
          phoneNumber: '+201000000000',
          phoneNumberVerified: true,
        },
      },
      error: null,
    });
    const { rerender } = render(<PhoneOTP onSignedIn={() => undefined} />);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '01000000000' } });
    fireEvent.click(sendButton());
    const frame = await waitFor(
      () => screen.getByTestId('phoneotp-hosted-frame') as HTMLIFrameElement,
    );
    vi.useFakeTimers();

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://auth.akedly.io',
      source: frame.contentWindow,
      data: { type: 'AUTH_SUCCESS' },
    }));
    rerender(<PhoneOTP onSignedIn={() => undefined} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(completePhoneOtp).toHaveBeenCalledTimes(1);
    expect(finishSignIn).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a transient completion failure', async () => {
    const frame = await renderHosted(true);
    completePhoneOtp
      .mockResolvedValueOnce({
        data: null,
        error: { status: 503, code: 'PHONE_OTP_UNAVAILABLE', message: 'Unavailable.' },
      })
      .mockResolvedValueOnce({
        data: {
          status: true,
          sessionCreated: true,
          user: {
            id: 'phone-user',
            phoneNumber: '+201000000000',
            phoneNumberVerified: true,
          },
        },
        error: null,
      });
    vi.useFakeTimers();

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://auth.akedly.io',
      source: frame.contentWindow,
      data: { type: 'AUTH_SUCCESS' },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(completePhoneOtp).toHaveBeenCalledTimes(1);
    expect(finishSignIn).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(completePhoneOtp).toHaveBeenCalledTimes(2);
    expect(finishSignIn).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a 429 completion response', async () => {
    const frame = await renderHosted(true);
    completePhoneOtp
      .mockResolvedValueOnce({
        data: null,
        error: { status: 429, code: 'RATE_LIMITED' },
      })
      .mockResolvedValueOnce({
        data: {
          status: true,
          sessionCreated: true,
          user: {
            id: 'phone-user',
            phoneNumber: '+201000000000',
            phoneNumberVerified: true,
          },
        },
        error: null,
      });
    vi.useFakeTimers();

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://auth.akedly.io',
      source: frame.contentWindow,
      data: { type: 'AUTH_SUCCESS' },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(completePhoneOtp).toHaveBeenCalledTimes(1);
    expect(finishSignIn).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(completePhoneOtp).toHaveBeenCalledTimes(2);
    expect(finishSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the unconfirmed error after the twenty-poll deadline', async () => {
    createIdempotencyKey
      .mockReturnValueOnce('idem-1')
      .mockReturnValueOnce('idem-2');
    const frame = await renderHosted(false);
    completePhoneOtp.mockResolvedValue({ data: { status: 'pending' }, error: null });
    vi.useFakeTimers();

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://auth.akedly.io',
      source: frame.contentWindow,
      data: { type: 'AUTH_SUCCESS' },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });

    expect(completePhoneOtp).toHaveBeenCalledTimes(20);
    expect(screen.getByText('phoneOtp.error.hostedUnconfirmed')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'phoneOtp.retryHosted' }));
      await Promise.resolve();
    });
    expect(startPhoneOtp).toHaveBeenLastCalledWith({
      phoneNumber: '01000000000',
      akedlyWidget: { connectionId: 'connection-hosted' },
      idempotencyKey: 'idem-2',
    });
  });
});
