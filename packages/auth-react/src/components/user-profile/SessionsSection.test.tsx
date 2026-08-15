// @vitest-environment jsdom
import * as React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sessions = [
    {
      id: 'session-current',
      userId: 'user-1',
      createdAt: new Date('2026-07-20T08:00:00.000Z'),
      updatedAt: new Date('2026-07-20T08:00:00.000Z'),
      expiresAt: new Date('2026-07-27T08:00:00.000Z'),
      userAgent: 'Current browser',
    },
    {
      id: 'session-other',
      userId: 'user-1',
      createdAt: new Date('2026-07-19T08:00:00.000Z'),
      updatedAt: new Date('2026-07-19T08:00:00.000Z'),
      expiresAt: new Date('2026-07-26T08:00:00.000Z'),
      userAgent: 'Other browser',
    },
  ];
  return {
    sessions,
    listSessions: vi.fn(async () => ({ data: sessions, error: null })),
    revokeSession: vi.fn(async () => ({ data: { status: true }, error: null })),
    revokeOtherSessions: vi.fn(async () => ({ data: { status: true }, error: null })),
    refetch: vi.fn(),
  };
});

vi.mock('../../hooks', () => ({
  useAccount: () => ({
    listSessions: mocks.listSessions,
    revokeSession: mocks.revokeSession,
    revokeOtherSessions: mocks.revokeOtherSessions,
  }),
  useSession: () => ({
    data: {
      user: { id: 'user-1' },
      session: { id: 'session-current', userId: 'user-1' },
    },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));

vi.mock('../../i18n', () => ({
  useLocale: () => 'en',
  useServerError: () => (_error: unknown, fallback: string) => fallback,
  useT: () => (key: string) => key,
}));

import { SessionsSection } from './SessionsSection';

describe('SessionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('marks the current device by id and revokes sessions without projecting a token', async () => {
    render(<SessionsSection />);

    const currentRow = (await screen.findByText('Current browser')).closest('li');
    const otherRow = screen.getByText('Other browser').closest('li');
    expect(currentRow).not.toBeNull();
    expect(otherRow).not.toBeNull();
    expect(within(currentRow!).getByText('userProfile.sessions.current')).toBeTruthy();

    const otherRevokeButton = within(otherRow!).getByRole('button', {
      name: 'userProfile.sessions.revoke',
    });
    const currentRevokeButton = within(currentRow!).getByRole('button', {
      name: 'userProfile.sessions.revoke',
    });

    fireEvent.click(otherRevokeButton);
    await waitFor(() =>
      expect(mocks.revokeSession).toHaveBeenLastCalledWith({ sessionId: 'session-other' }),
    );
    expect(mocks.refetch).not.toHaveBeenCalled();
    await waitFor(() => expect(otherRevokeButton).toHaveProperty('disabled', false));

    fireEvent.click(currentRevokeButton);
    await waitFor(() =>
      expect(mocks.revokeSession).toHaveBeenLastCalledWith({ sessionId: 'session-current' }),
    );
    await waitFor(() =>
      expect(mocks.refetch).toHaveBeenCalledWith({
        query: { disableCookieCache: true },
      }),
    );
  });
});
