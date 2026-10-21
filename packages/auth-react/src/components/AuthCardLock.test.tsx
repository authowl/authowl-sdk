// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthCardLock, useAuthCardLock, useAuthCardPending } from './AuthCardLock';

afterEach(cleanup);

function Reporter({ pending }: { pending: boolean }) {
  useAuthCardPending(pending);
  return null;
}

function Card({ first, second }: { first: boolean | null; second: boolean }) {
  const lock = useAuthCardLock(false);
  return <AuthCardLock.Provider value={lock}>
    {first !== null && <Reporter pending={first} />}
    <Reporter pending={second} />
    <button disabled={lock.locked}>Start</button>
  </AuthCardLock.Provider>;
}

describe('card pending reporters', () => {
  it.each([false, null])('keeps the other request locked when a reporter ends or unmounts (%s)', (first) => {
    const view = render(<React.StrictMode><Card first second /></React.StrictMode>);
    const button = screen.getByRole<HTMLButtonElement>('button');
    expect(button.disabled).toBe(true);
    view.rerender(<React.StrictMode><Card first={first} second /></React.StrictMode>);
    expect(button.disabled).toBe(true);
    view.rerender(<React.StrictMode><Card first={first} second={false} /></React.StrictMode>);
    expect(button.disabled).toBe(false);
    view.rerender(<React.StrictMode><Card first={true} second={false} /></React.StrictMode>);
    expect(button.disabled).toBe(true);
    view.rerender(<React.StrictMode><Card first={false} second={false} /></React.StrictMode>);
    expect(button.disabled).toBe(false);
  });
});
