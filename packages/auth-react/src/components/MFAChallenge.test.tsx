// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useUser: () => ({ user: null }),
  useMFA: () => mocks,
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  richMessage: (key: string, slots: Record<string, React.ReactNode>) => <>{key}{slots.email}</>,
  Bidi: ({ children }: { children: React.ReactNode }) => children,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { MFAChallenge } from './MFAChallenge';

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('MFAChallenge trust-device control', () => {
  afterEach(() => {
    mocks.config = null;
  });

  it('uses the SDK checkbox skin instead of the browser-native dark square', () => {
    const { container } = render(<MFAChallenge />);
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');

    expect(checkbox).not.toBeNull();
    expect(checkbox?.classList.contains('ba-checkbox')).toBe(true);
    const label = checkbox?.closest('label');
    expect(label?.classList.contains('ba-consent')).toBe(true);
    expect(label?.classList.contains('ba-consent-centered')).toBe(true);
  });

  it('hides server-disabled recovery controls under high assurance', () => {
    mocks.config = {
      mfa: {
        totp: true,
        required: true,
        backupCodes: true,
        emailOtpFallback: false,
        trustDevice: false,
      },
    } as PublicConfig;

    const { container } = render(<MFAChallenge />);

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'mfa.challenge.otpLabel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'mfa.challenge.backupLabel' })).toBeTruthy();
  });

  it('preserves both controls for a rolling-upgrade server without capability flags', () => {
    mocks.config = {
      mfa: { totp: true, required: true, backupCodes: true },
    } as PublicConfig;

    const { container } = render(<MFAChallenge />);

    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'mfa.challenge.otpLabel' })).toBeTruthy();
  });
});

describe('MFAChallenge step-up variant', () => {
  afterEach(() => {
    mocks.config = null;
  });

  it('names the moment it is actually for', () => {
    render(<MFAChallenge variant="step-up" />);

    expect(screen.getByText('mfa.stepUp.title')).toBeTruthy();
    expect(screen.queryByText('mfa.challenge.title')).toBeNull();
  });

  it('never offers device trust, even where the posture allows it', () => {
    // The engine's full-session branch ignores `trustDevice` outright, so the
    // checkbox would be a control that silently does nothing.
    mocks.config = {
      mfa: { totp: true, required: true, backupCodes: true, trustDevice: true },
    } as PublicConfig;

    const { container } = render(<MFAChallenge variant="step-up" allowTrustDevice />);

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('keeps every recovery factor the posture still permits', () => {
    render(<MFAChallenge variant="step-up" />);

    expect(screen.getByRole('button', { name: 'mfa.challenge.backupLabel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'mfa.challenge.otpLabel' })).toBeTruthy();
  });

  it('offers a way out only when the caller can take one', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<MFAChallenge variant="step-up" />);
    expect(screen.queryByText('common.cancel')).toBeNull();

    rerender(<MFAChallenge variant="step-up" onCancel={onCancel} />);
    fireEvent.click(screen.getByText('common.cancel'));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});


describe('MFAChallenge code completion', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('auto-submits once, remains locked during verification and shows success while finishing', async () => {
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    const onVerified = vi.fn(() => new Promise<void>(() => {}));
    render(<MFAChallenge onVerified={onVerified} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByTestId('mfa-challenge'));
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(mocks.verifyTotp).toHaveBeenCalledExactlyOnceWith({ code: '123456', trustDevice: false });
    expect(screen.getByRole('textbox').parentElement?.getAttribute('data-state')).toBe('success');
    expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('does not auto-retry a failed value and keeps backup codes as unsanitized text with manual submit', async () => {
    mocks.verifyTotp.mockResolvedValue({ data: null, error: { code: 'INVALID_CODE' } });
    mocks.verifyBackupCode.mockResolvedValue({ data: {}, error: null });
    render(<MFAChallenge />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
    await screen.findByRole('alert');
    expect(mocks.verifyTotp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.backupLabel' }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: ' backup-Ab12-3456 ' } });
    expect(input.value).toBe('backup-Ab12-3456');
    expect(input.maxLength).toBe(-1);
    expect(input.closest('.ao-code-input')).toBeNull();
    expect(mocks.verifyBackupCode).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByTestId('mfa-challenge'));
    await waitFor(() => expect(mocks.verifyBackupCode).toHaveBeenCalledExactlyOnceWith({ code: 'backup-Ab12-3456' }));
  });

  it('emails a fallback code and auto-submits it exactly once', async () => {
    mocks.sendOtp.mockResolvedValue({ data: {}, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null });
    render(<MFAChallenge email="mona@example.test" />);
    fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.otpLabel' }));
    const input = await screen.findByRole('textbox', { name: 'mfa.challenge.otpLabel' });
    expect(screen.getByText('mona@example.test').closest('strong')).not.toBeNull();
    fireEvent.change(input, { target: { value: '654321' } });
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledExactlyOnceWith({ code: '654321', trustDevice: false }));
    expect(screen.getByRole('button', { name: 'mfa.challenge.resendOtp' })).toBeTruthy();
  });
});


it('retains focus, selects the failed code and keeps its error on a no-op paste', async () => {
  let fail!: (value: unknown) => void;
  mocks.verifyTotp.mockReturnValue(new Promise((resolve) => { fail = resolve; }));
  render(<MFAChallenge />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: '123456' } });
  expect(input.readOnly).toBe(true);
  expect(input.disabled).toBe(false);
  expect(document.activeElement).toBe(input);
  await act(async () => { fail({ data: null, error: { code: 'INVALID_CODE' } }); });
  expect(document.activeElement).toBe(input);
  expect(input.readOnly).toBe(false);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(6);
  fireEvent.select(input);
  expect(input.selectionStart).toBe(0);
  fireEvent.paste(input, { clipboardData: { getData: () => '123-456' } });
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'mfa.challenge.submit' })).toBeNull();
});

it.each(['network', 'server'] as const)('offers a visible Verify retry after a %s failure in code mode', async (failure) => {
  if (failure === 'network') mocks.verifyTotp.mockRejectedValueOnce(new Error('offline'));
  else mocks.verifyTotp.mockResolvedValueOnce({ data: null, error: { code: 'INTERNAL_SERVER_ERROR', status: 500 } });
  render(<MFAChallenge />);
  expect(screen.queryByRole('button', { name: 'mfa.challenge.submit' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
  await screen.findByRole('alert');
  mocks.verifyTotp.mockResolvedValueOnce({ data: {}, error: null });
  fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.submit' }));
  await screen.findByText('codeInput.verified');
});

it('uses visible chip names and labels Other ways in as a group', () => {
  render(<MFAChallenge />);
  const group = screen.getByRole('group', { name: 'mfa.challenge.otherWays' });
  for (const chip of group.querySelectorAll('button')) {
    expect(screen.getByRole('button', { name: chip.textContent! })).toBe(chip);
    expect(chip.hasAttribute('aria-label')).toBe(false);
  }
});

it('keeps resend pending independent from verifying, and status excludes the resend button', async () => {
  let sent!: (value: unknown) => void;
  mocks.sendOtp.mockReturnValueOnce(new Promise((resolve) => { sent = resolve; }));
  render(<MFAChallenge />);
  fireEvent.click(screen.getByRole('button', { name: 'mfa.challenge.otpLabel' }));
  expect(screen.getByRole('textbox')).toHaveProperty('readOnly', true);
  expect(screen.queryByText('common.verifying')).toBeNull();
  expect(mocks.verifyOtp).not.toHaveBeenCalled();
  await act(async () => { sent({ data: {}, error: null }); });
  const resend = screen.getByRole('button', { name: 'mfa.challenge.resendOtp' });
  expect(resend.closest('[role="status"]')).toBeNull();
  const sending = new Promise<never>(() => {});
  mocks.verifyOtp.mockReturnValueOnce(sending);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '654321' } });
  expect(screen.getByRole('status').textContent).toBe('common.verifying');
  expect(resend).toHaveProperty('disabled', true);
  expect(mocks.sendOtp).toHaveBeenCalledTimes(1);
});
