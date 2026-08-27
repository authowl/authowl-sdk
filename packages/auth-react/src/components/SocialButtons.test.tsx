// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signInSocial: vi.fn(
    async (): Promise<{
      data: { redirect: boolean; url: string } | null;
      error: { code: string } | null;
    }> => ({
      data: { redirect: true, url: 'https://accounts.example.test/oauth' },
      error: null,
    }),
  ),
}));

vi.mock('../hooks', () => ({
  useSignIn: () => ({ signInSocial: mocks.signInSocial }),
  // The buttons park which provider is being tried before navigating away, and
  // that is scoped per project, so the recorder needs the resolved config.
  usePublicConfig: () => ({
    config: { environmentId: '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../i18n', () => ({
  useServerError: () => (_error: unknown, fallback: string) => fallback,
  useT: () => (key: string, values?: { provider?: string }) =>
    key === 'social.continueWith' ? `Continue with ${values?.provider}` : key,
}));

import { SocialButtons } from './SocialButtons';

describe('SocialButtons OAuth return destination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('returns to the current page when no callback is configured', async () => {
    render(<SocialButtons providers={['google']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() =>
      expect(mocks.signInSocial).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: window.location.href,
        // Named so a start failure comes back HERE. Without it the first-party
        // transport strands the user on raw JSON at the auth host.
        errorCallbackURL: window.location.href,
      }),
    );
  });

  it('preserves an explicit callback destination', async () => {
    render(
      <SocialButtons
        providers={['google']}
        callbackURL="https://app.example.test/auth/complete"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() =>
      expect(mocks.signInSocial).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: 'https://app.example.test/auth/complete',
        errorCallbackURL: window.location.href,
      }),
    );
  });

  it('shows a spinner and keeps it after a successful start (redirect persists)', async () => {
    const { container } = render(<SocialButtons providers={['google']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(mocks.signInSocial).toHaveBeenCalled());
    // Browser redirects away on success: spinner + aria-busy persist (not reset).
    await waitFor(() => expect(container.querySelector('.ba-spinner')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'social.redirecting' }).getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('clears the spinner and re-enables when the start fails', async () => {
    mocks.signInSocial.mockResolvedValueOnce({ data: null, error: { code: 'X' } });
    const { container } = render(<SocialButtons providers={['google']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(mocks.signInSocial).toHaveBeenCalled());
    // No redirect happened: back to idle - spinner gone, aria-busy cleared, re-enabled.
    await waitFor(() => expect(container.querySelector('.ba-spinner')).toBeNull());
    const button = screen.getByRole('button', { name: 'Continue with Google' });
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});
