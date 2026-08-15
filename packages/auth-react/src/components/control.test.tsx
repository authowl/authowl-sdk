// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isLoaded: false }));

vi.mock('../hooks', () => ({
  useUser: () => ({
    user: null,
    isLoaded: mocks.isLoaded,
    isSignedIn: false,
    needsMfaEnrollment: false,
    error: null,
  }),
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
}));

import { AuthLoading, AuthLoaded } from './control';

describe('AuthLoading', () => {
  afterEach(cleanup);

  it('shows a centered spinner with an sr-only label while the session is loading', () => {
    mocks.isLoaded = false;
    const { container } = render(<AuthLoading />);

    const region = screen.getByTestId('auth-loading');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.ba-spinner')).not.toBeNull();
    // The default fallback carries the sr-only common.loading label.
    expect(screen.getByText('common.loading')).toBeDefined();
  });

  it('renders nothing once the session has loaded', () => {
    mocks.isLoaded = true;
    const { container } = render(<AuthLoading />);
    expect(container.firstChild).toBeNull();
  });

  it('renders custom children while loading and nothing after', () => {
    mocks.isLoaded = false;
    const { container, rerender } = render(
      <AuthLoading>
        <p>hold on</p>
      </AuthLoading>,
    );
    expect(screen.getByText('hold on')).toBeDefined();
    // No default spinner when custom children are supplied.
    expect(container.querySelector('.ba-spinner')).toBeNull();

    mocks.isLoaded = true;
    rerender(
      <AuthLoading>
        <p>hold on</p>
      </AuthLoading>,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('AuthLoaded', () => {
  afterEach(cleanup);

  it('renders its children only once the session has loaded', () => {
    mocks.isLoaded = false;
    const { rerender } = render(
      <AuthLoaded>
        <p>ready</p>
      </AuthLoaded>,
    );
    expect(screen.queryByText('ready')).toBeNull();

    mocks.isLoaded = true;
    rerender(
      <AuthLoaded>
        <p>ready</p>
      </AuthLoaded>,
    );
    expect(screen.getByText('ready')).toBeDefined();
  });
});
