// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  join: vi.fn(async () => ({ data: { accepted: true }, error: null })),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({
    config: { authTurnstileSiteKey: null, badge: false },
    isLoading: false,
    isError: false,
  }),
  useWaitlist: () => ({ join: mocks.join }),
}));

vi.mock('../i18n', () => ({
  useServerError: () => (_error: unknown, fallback: string) => fallback,
  useT: () => (key: string) => key,
}));

import { Waitlist } from './Waitlist';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Waitlist', () => {
  it('submits one email and renders the privacy-safe accepted state', async () => {
    const onJoined = vi.fn();
    render(<Waitlist onJoined={onJoined} />);

    fireEvent.change(screen.getByLabelText('common.emailLabel'), {
      target: { value: 'mona@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'waitlist.submit' }));

    await waitFor(() => expect(mocks.join).toHaveBeenCalledWith(
      { email: 'mona@example.test' },
      undefined,
    ));
    expect(await screen.findByTestId('waitlist-accepted')).toBeTruthy();
    expect(screen.getByText('waitlist.acceptedDescription')).toBeTruthy();
    expect(onJoined).toHaveBeenCalledOnce();
  });
});
