// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    environmentType: 'development' as 'development' | 'production',
    branding: {
      appName: 'Acme',
      logoUrl: 'https://cdn.example.com/acme.svg',
      showAppName: true,
      alignment: 'right' as 'left' | 'center' | 'right',
    },
  },
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
}));

import { AuthOwlBranding } from './AuthOwlBranding';

afterEach(cleanup);

describe('AuthOwlBranding', () => {
  it('renders the configured logo, name, alignment, and environment', () => {
    const { container } = render(<AuthOwlBranding />);

    expect(screen.getByRole('img', { name: 'Acme logo' }).getAttribute('src')).toBe(
      'https://cdn.example.com/acme.svg',
    );
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('branding.environment.development')).toBeTruthy();
    expect(container.querySelector('.ba-branding-align-right')).not.toBeNull();
  });

  it('supports a logo-only brand without inventing application text', () => {
    mocks.config.branding.showAppName = false;
    const { container } = render(<AuthOwlBranding />);

    expect(screen.getByRole('img', { name: 'Application logo' })).toBeTruthy();
    expect(screen.queryByText('Acme')).toBeNull();
    expect(container.querySelector('.ba-branding-name')).toBeNull();
    mocks.config.branding.showAppName = true;
  });
});
