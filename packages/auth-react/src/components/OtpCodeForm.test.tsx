// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthCardLock } from './AuthCardLock';
import { OtpCodeForm } from './OtpCodeForm';

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
  richMessage: (key: string) => key,
  Bidi: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(cleanup);

it('submits the committed final digit once and respects pending and the card lock', () => {
  const submit = vi.fn(() => new Promise<never>(() => {}));
  function Form({ locked = false }: { locked?: boolean }) {
    const [code, setCode] = React.useState('');
    return <AuthCardLock.Provider value={{ locked, setPending: vi.fn() }}>
      <OtpCodeForm email="mona@example.test" code={code} onCodeChange={setCode}
        onChangeEmail={vi.fn()} onSubmit={() => submit()} onSuccess={vi.fn()} />
    </AuthCardLock.Provider>;
  }
  const { rerender } = render(<Form locked />);
  expect((screen.getByRole('textbox') as HTMLInputElement).readOnly).toBe(true);
  fireEvent.submit(screen.getByTestId('emailotp-code'));
  expect(submit).not.toHaveBeenCalled();
  rerender(<Form />);
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => '123 456' } });
  fireEvent.submit(screen.getByTestId('emailotp-code'));
  expect(submit).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('textbox') as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(false);
});
