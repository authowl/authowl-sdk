// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthCardLock } from './AuthCardLock';
import { OtpCodeForm } from './OtpCodeForm';

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  richMessage: (key: string) => key,
  Bidi: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(cleanup);

it('submits the committed final digit once and respects pending and the card lock', () => {
  const submit = vi.fn();
  function Form({ locked = false }: { locked?: boolean }) {
    const [code, setCode] = React.useState('');
    const [pending, setPending] = React.useState(false);
    return <AuthCardLock.Provider value={{ locked, setPending: vi.fn() }}>
      <OtpCodeForm email="mona@example.test" code={code} onCodeChange={setCode} pending={pending} error={null}
        onChangeEmail={vi.fn()} onSubmit={() => { submit(code); setPending(true); }} />
    </AuthCardLock.Provider>;
  }
  const { rerender } = render(<Form locked />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '123456' } });
  expect(submit).not.toHaveBeenCalled();
  rerender(<Form />);
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => '123 456' } });
  fireEvent.submit(screen.getByTestId('emailotp-code'));
  expect(submit).toHaveBeenCalledExactlyOnceWith('123456');
  expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
});
