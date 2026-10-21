// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthCardLock, useAuthCardLock } from './AuthCardLock';

const mocks = vi.hoisted(() => ({
  sendEmailOtp: vi.fn(async () => ({ data: {}, error: null })),
  signInEmailOtp: vi.fn(),
  finishSignIn: vi.fn(),
}));
vi.mock('../hooks', () => ({
  useAuthClient: () => ({ sessionStore: {} }),
  useSignIn: () => mocks,
}));
vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
  richMessage: (key: string) => key,
  Bidi: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./AuthChallenge', () => ({
  AUTH_CHALLENGE_ACTIONS: { passwordless: 'passwordless' },
  useAuthChallenge: () => ({ run: (_action: unknown, send: () => unknown) => send(), control: null }),
}));
vi.mock('./finish-sign-in', () => ({ finishSignIn: mocks.finishSignIn }));
import { EmailOtpForm } from './EmailOtpForm';
afterEach(cleanup);

it('holds pending and the card lock until finishSignIn settles', async () => {
  let finish!: () => void;
  mocks.signInEmailOtp.mockResolvedValue({ data: {}, error: null });
  mocks.finishSignIn.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  function Card() {
    const lock = useAuthCardLock(false);
    return <AuthCardLock.Provider value={lock}>
      <EmailOtpForm /><button disabled={lock.locked}>Other method</button>
    </AuthCardLock.Provider>;
  }
  render(<Card />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mona@example.test' } });
  fireEvent.submit(screen.getByTestId('emailotp-email'));
  await screen.findByTestId('emailotp-code');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
  await waitFor(() => expect(mocks.finishSignIn).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'common.verifying' }).getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('button', { name: 'Other method' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('textbox').parentElement?.getAttribute('data-state')).toBe('success');
  await act(async () => { finish(); });
  expect(screen.getByRole('button', { name: 'Other method' })).toHaveProperty('disabled', false);
  expect(screen.queryByRole('button', { name: 'common.verifying' })).toBeNull();
});
