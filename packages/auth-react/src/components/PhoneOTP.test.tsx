// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthActionResult, PhoneOtpChallengeData } from '@authowl/core';

// vi.mock factories are hoisted above const declarations, so the spies have to
// be created inside vi.hoisted to exist by the time a factory runs.
const {
  preparePhoneOtp,
  startPhoneOtp,
  verifyPhoneOtp,
  solvePhoneOtpChallenge,
} = vi.hoisted(() => ({
  preparePhoneOtp: vi.fn(),
  startPhoneOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
  solvePhoneOtpChallenge: vi.fn(),
}));

vi.mock('@authowl/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIdempotencyKey: () => 'idempotency-key-1',
  solvePhoneOtpChallenge,
}));
vi.mock('../hooks', () => ({
  useAuthClient: () => ({ sessionStore: { subscribe: () => () => {}, getSnapshot: () => null } }),
  usePublicConfig: () => ({
    config: { turnstileSiteKey: 'site-key', branding: { theme: 'light' }, legal: null },
    isLoading: false,
  }),
  useSignIn: () => ({ preparePhoneOtp, startPhoneOtp, verifyPhoneOtp }),
}));
vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  Bidi: ({ children }: { children?: unknown }) => children,
  useServerError: () => (error: { message?: string } | null) => error?.message ?? null,
  richMessage: (key: string) => key,
}));
vi.mock('./Turnstile', () => ({ Turnstile: () => <div data-testid="turnstile" /> }));

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

describe('PhoneOTP challenge gating', () => {
  beforeEach(() => {
    preparePhoneOtp.mockReset();
    startPhoneOtp.mockReset();
    verifyPhoneOtp.mockReset();
    solvePhoneOtpChallenge.mockReset();
  });
  afterEach(cleanup);

  it('keeps send disabled while the server has not said which challenge applies', async () => {
    // `guard === null` means UNKNOWN, not "no challenge required". Enabling the
    // button here would let a click through before any anti-abuse proof exists.
    const pendingPrepare = deferred<AuthActionResult<PhoneOtpChallengeData>>();
    preparePhoneOtp.mockReturnValue(pendingPrepare.promise);

    render(<PhoneOTP />);
    expect(sendButton().disabled).toBe(true);

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
    startPhoneOtp.mockResolvedValue({ data: { status: true }, error: null });
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
});
