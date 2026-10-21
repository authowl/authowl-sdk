// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ enable: vi.fn(), verifyTotp: vi.fn() }));
vi.mock('../hooks', () => ({
  useMFA: () => mocks,
  useUser: () => ({ user: { id: 'user-1', twoFactorEnabled: false }, isLoaded: true }),
}));
vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
  richMessage: (key: string) => key,
  Bidi: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./QrCode', () => ({ QrCode: () => <div /> }));
import { MFAEnrollment } from './MFAEnrollment';
afterEach(cleanup);

it('auto-verifies once and immediately drops enrolment secrets before handing off', async () => {
  mocks.enable.mockResolvedValue({ data: { totpURI: 'otpauth://totp/test?secret=SECRET', backupCodes: ['backup-secret'] }, error: null });
  mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
  const onEnrolled = vi.fn(() => {
    expect(screen.queryByText('backup-secret')).toBeNull();
    expect(screen.queryByTestId('mfa-enroll-verify')).toBeNull();
  });
  render(<MFAEnrollment onEnrolled={onEnrolled} />);
  fireEvent.change(screen.getByLabelText('common.passwordLabel'), { target: { value: 'password' } });
  fireEvent.submit(screen.getByTestId('mfa-enroll-password'));
  await screen.findByTestId('mfa-enroll-verify');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
  await screen.findByTestId('mfa-enroll-done');
  expect(mocks.verifyTotp).toHaveBeenCalledExactlyOnceWith({ code: '123456' });
  await waitFor(() => expect(onEnrolled).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('mfa-enroll-verify')).toBeNull();
  expect(screen.queryByText('backup-secret')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});
