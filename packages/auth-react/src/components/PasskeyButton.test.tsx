// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';
import { makePublicConfig } from '../test-fixtures';

const mocks = vi.hoisted(() => ({ config: null as PublicConfig | null }));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useAuthClient: () => ({ sessionStore: {} }),
  useSignIn: () => ({ signInPasskey: vi.fn() }),
}));
vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { PasskeyButton } from './PasskeyButton';

const configFor = (authBaseUrl: string): PublicConfig =>
  makePublicConfig({ enabledMethods: ['password', 'passkey'], authBaseUrl });

describe('PasskeyButton reachability', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(cleanup);

  it('renders on an origin the relying party covers', () => {
    mocks.config = configFor('http://localhost:3000');
    render(<PasskeyButton />);

    expect(screen.queryByTestId('passkey-button')).toBeTruthy();
  });

  // <SignIn/> renders this behind `plan.passkey`, which asks the same question,
  // so the component was safe THERE and a dead end anywhere else. It is exported
  // from the package index, so "anywhere else" is a supported way to use it.
  it('renders nothing when mounted outside the relying party', () => {
    mocks.config = configFor('https://acme-1234.accounts.authowl.dev');
    render(<PasskeyButton />);

    expect(screen.queryByTestId('passkey-button')).toBeNull();
  });

  // Fail OPEN on an unknown answer: config still loading must not blank a
  // sign-in method that is probably fine, and the ceremony error still guards.
  it('renders while the config is still unknown', () => {
    mocks.config = null;
    render(<PasskeyButton />);

    expect(screen.queryByTestId('passkey-button')).toBeTruthy();
  });
});
