// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
  isLoading: false,
  isError: false,
  listPasskeys: vi.fn<() => Promise<{ data: unknown[] | null; error: unknown }>>(),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({
    config: mocks.config, isLoading: mocks.isLoading, isError: mocks.isError,
  }),
  useUser: () => ({ user: { id: 'user-1' }, isLoaded: true, isSignedIn: true }),
  usePasskeys: () => ({
    listPasskeys: mocks.listPasskeys,
    addPasskey: vi.fn(),
    updatePasskey: vi.fn(),
    deletePasskey: vi.fn(),
  }),
}));

vi.mock('../i18n', () => ({
  // Mirrors `formatMessage`'s own `{name}` substitution rather than dumping the
  // params: a component that passed `{ host }` for a `{domain}` template would
  // otherwise satisfy every assertion here and still render a literal
  // placeholder to a user.
  useT: () => (key: string, vars?: Record<string, string>) => {
    const template = key === 'passkeys.addElsewhere' ? `${key}: added on {domain}` : key;
    return template.replace(
      /\{(\w+)\}/g,
      (match, name: string) => (vars && name in vars ? String(vars[name]) : match),
    );
  },
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { PasskeyManager } from './PasskeyManager';
import { makePublicConfig } from '../test-fixtures';

// The package's own config factory, unmodified, so a new required field on the
// server contract reaches this test instead of being frozen out by a literal.
const configFor = (authBaseUrl: string): PublicConfig =>
  makePublicConfig({ enabledMethods: ['password', 'passkey'], authBaseUrl });

describe('PasskeyManager add-button reachability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLoading = false;
    mocks.isError = false;
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

  it('respects allowAdd=false regardless of reachability', async () => {
    mocks.config = configFor('https://acme-1234.accounts.authowl.dev');
    render(<PasskeyManager allowAdd={false} />);

    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalled());
    expect(screen.queryByText('passkeys.add')).toBeNull();
    expect(screen.queryByTestId('passkey-add-elsewhere')).toBeNull();
  });

  // THE RESIDUAL SLIVER of the founder-facing bug. `config` starts null and null
  // reads as "not blocked", so whenever the passkey list resolved before the
  // config did, a blocked host still showed a live, clickable Add button that
  // threw the SecurityError this whole gate exists to remove.
  it('holds the add button while the config is still loading', async () => {
    mocks.config = null;
    mocks.isLoading = true;
    render(<PasskeyManager />);

    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalled());
    expect(screen.queryByText('passkeys.add')).toBeNull();
    expect(screen.queryByTestId('passkey-add-elsewhere')).toBeNull();
  });

  // Keyed on LOADING, not absence: a config fetch that FAILED must still offer
  // the button, or one transient error silently kills enrolment on a host where
  // passkeys work perfectly well. The click-time error remains the backstop.
  it('offers the add button when the config fetch failed outright', async () => {
    mocks.config = null;
    mocks.isError = true;
    render(<PasskeyManager />);

    expect(await screen.findByText('passkeys.add')).toBeTruthy();
  });
});
