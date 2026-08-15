// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks', () => ({
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
  it('uses the SDK checkbox skin instead of the browser-native dark square', () => {
    const { container } = render(<MFAChallenge />);
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');

    expect(checkbox).not.toBeNull();
    expect(checkbox?.classList.contains('ba-checkbox')).toBe(true);
    const label = checkbox?.closest('label');
    expect(label?.classList.contains('ba-consent')).toBe(true);
    expect(label?.classList.contains('ba-consent-centered')).toBe(true);
  });
});
