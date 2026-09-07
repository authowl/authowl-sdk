// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
  listPasskeys: vi.fn(async () => ({ data: [] as unknown[], error: null })),
  addPasskey: vi.fn(async () => ({ data: { id: 'passkey-1' }, error: null })),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useUser: () => ({ user: { id: 'user-1' }, isLoaded: true, isSignedIn: true }),
  usePasskeys: () => ({
    listPasskeys: mocks.listPasskeys,
    addPasskey: mocks.addPasskey,
    updatePasskey: vi.fn(),
    deletePasskey: vi.fn(),
  }),
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { PasskeyManager } from './PasskeyManager';
import { passkeyReachableForConfig } from '../signin-methods';

const authentication = {
  email: { signUp: true, signIn: ['password'] },
  phone: { signUp: false, signIn: false },
  password: { signUp: true, add: true },
  username: { collectOnSignUp: false, signIn: false },
  passkey: { signIn: true, add: true },
};

const configFor = (authBaseUrl: string, relyingPartyId?: string) => ({
  environmentId: 'env_1',
  authBaseUrl,
  enabledMethods: ['password', 'passkey'],
  authentication: relyingPartyId
    ? { ...authentication, passkey: { ...authentication.passkey, relyingPartyId } }
    : authentication,
} as unknown as PublicConfig);

describe('PasskeyManager add-button reachability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPasskeys.mockResolvedValue({ data: [], error: null });
  });
  afterEach(cleanup);

  // jsdom serves the page from `localhost`.
  it('offers the add button when the relying party covers this page', async () => {
    mocks.config = configFor('http://localhost:3000');
    render(<PasskeyManager />);

    expect(await screen.findByText('passkeys.add')).toBeTruthy();
    expect(screen.queryByTestId('passkey-add-elsewhere')).toBeNull();
  });

  // THE BUG THIS PINS: the founder's app embeds this component on its own
  // domain, the relying party is the portal host, and every click died in a
  // SecurityError rendered as "Passkeys are not set up for this site's domain."
  // That message sent him hunting through DNS for a ceremony no configuration
  // could have made succeed from here.
  it('hides the add button, and names the domain, when the page is outside the relying party', async () => {
    mocks.config = configFor('https://acme-1234.accounts.authowl.dev');
    render(<PasskeyManager />);

    const guidance = await screen.findByTestId('passkey-add-elsewhere');
    expect(guidance.textContent).toContain('acme-1234.accounts.authowl.dev');
    expect(screen.queryByText('passkeys.add')).toBeNull();
  });

  it('keeps the list on an unreachable origin, so passkeys enrolled elsewhere stay manageable', async () => {
    mocks.listPasskeys.mockResolvedValue({
      data: [{ id: 'p1', name: 'Work laptop', createdAt: new Date().toISOString() }],
      error: null,
    });
    mocks.config = configFor('https://acme-1234.accounts.authowl.dev');
    render(<PasskeyManager />);

    expect(await screen.findByText('Work laptop')).toBeTruthy();
    expect(screen.queryByText('passkeys.add')).toBeNull();
  });

  // The server's explicit id wins over the host derivation, so a project that
  // pinned its own relying party is judged against THAT, not the API host.
  it('honours an explicit relying-party id from public config', async () => {
    mocks.config = configFor('https://acme-1234.accounts.authowl.dev', 'localhost');
    render(<PasskeyManager />);

    expect(await screen.findByText('passkeys.add')).toBeTruthy();
  });

  it('does not hide the button when the page host is unknowable', () => {
    // The contract the component leans on for server rendering, asserted
    // directly because jsdom always has a hostname and cannot stage it: an
    // unknown host must NOT hide the button. A server render knows neither the
    // host nor that offering would be wrong, and the click-time error guards.
    expect(passkeyReachableForConfig(configFor('https://acme.accounts.authowl.dev'), undefined))
      .toBe(true);
  });

  it('respects allowAdd=false regardless of reachability', async () => {
    mocks.config = configFor('http://localhost:3000');
    render(<PasskeyManager allowAdd={false} />);

    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalled());
    expect(screen.queryByText('passkeys.add')).toBeNull();
    expect(screen.queryByTestId('passkey-add-elsewhere')).toBeNull();
  });
});
