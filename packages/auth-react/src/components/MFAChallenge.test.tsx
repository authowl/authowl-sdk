// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useMFA: () => ({
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
  }),
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { MFAChallenge } from './MFAChallenge';

afterEach(cleanup);

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
    expect(screen.queryByText('mfa.challenge.useEmailOtp')).toBeNull();
    expect(screen.getByText('mfa.challenge.useBackup')).toBeTruthy();
  });

  it('preserves both controls for a rolling-upgrade server without capability flags', () => {
    mocks.config = {
      mfa: { totp: true, required: true, backupCodes: true },
    } as PublicConfig;

    const { container } = render(<MFAChallenge />);

    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(screen.getByText('mfa.challenge.useEmailOtp')).toBeTruthy();
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

    expect(screen.getByText('mfa.challenge.useBackup')).toBeTruthy();
    expect(screen.getByText('mfa.challenge.useEmailOtp')).toBeTruthy();
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
