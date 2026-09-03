// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
  user: null as { id: string; twoFactorEnabled: boolean } | null,
  listPasskeys: vi.fn(async (): Promise<{ data: unknown[] | null; error: unknown }> => ({
    data: [],
    error: null,
  })),
  addPasskey: vi.fn(async () => ({ data: { id: 'passkey-1' }, error: null })),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useUser: () => ({ user: mocks.user, isSignedIn: mocks.user !== null }),
  usePasskeys: () => ({ listPasskeys: mocks.listPasskeys, addPasskey: mocks.addPasskey }),
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { PasskeyOfferGate } from './PasskeyOfferGate';

const authentication = {
  email: { signUp: true, signIn: ['password'] },
  phone: { signUp: false, signIn: false },
  password: { signUp: true, add: true },
  username: { collectOnSignUp: false, signIn: false },
  passkey: { signIn: true, add: true },
};

const app = () => <PasskeyOfferGate><p>the app</p></PasskeyOfferGate>;

describe('PasskeyOfferGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.listPasskeys.mockResolvedValue({ data: [], error: null });
    mocks.config = {
      environmentId: 'env_1',
      authBaseUrl: 'http://localhost:3000',
      enabledMethods: ['password', 'passkey'],
      authentication,
    } as unknown as PublicConfig;
    mocks.user = { id: 'user-1', twoFactorEnabled: false };
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true });
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'PublicKeyCredential');
  });

  it('offers once the checks confirm, on a session that is already signed in', async () => {
    // The redirect flow lands here ALREADY signed in, which is why the gate
    // fires on mount-when-due rather than on a signed-out -> in transition.
    render(app());

    expect(await screen.findByTestId('passkey-offer')).toBeTruthy();
  });

  it('never blocks the app while it decides', async () => {
    let release: (v: { data: unknown[]; error: unknown }) => void = () => {};
    mocks.listPasskeys.mockReturnValue(new Promise((resolve) => {
      release = resolve;
    }));
    render(app());

    // The app is on screen the whole time the checks are outstanding: this is
    // an optional offer, not a gate, and a blank flash here would be a
    // regression on a surface that already has one.
    expect(screen.getByText('the app')).toBeTruthy();
    release({ data: [], error: null });
    expect(await screen.findByTestId('passkey-offer')).toBeTruthy();
  });

  it('does not offer to a 2FA user whose session arrives after the gate mounts', async () => {
    // Reached the way the real flow reaches it. An earlier version of this
    // check ran inside <SignIn/>, where no user is loaded yet, so
    // `twoFactorEnabled` read undefined and the gate passed for everyone - and
    // a test that pre-set the user blessed it.
    mocks.user = null;
    const view = render(app());
    expect(screen.getByText('the app')).toBeTruthy();

    mocks.user = { id: 'user-1', twoFactorEnabled: true };
    view.rerender(app());

    await waitFor(() => expect(mocks.listPasskeys).not.toHaveBeenCalled());
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('shows the app, not the offer, to someone who already has a passkey', async () => {
    mocks.listPasskeys.mockResolvedValue({ data: [{ id: 'passkey-1' }], error: null });
    render(app());

    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalled());
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
  });

  it('returns to the app and stops asking once a passkey is added', async () => {
    render(app());
    fireEvent.click(await screen.findByText('passkeyOffer.submit'));

    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
    expect(mocks.addPasskey).toHaveBeenCalledOnce();

    cleanup();
    render(app());
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
  });

  it('returns to the app when declined, and does not ask again this cool-off', async () => {
    render(app());
    fireEvent.click(await screen.findByText('passkeyOffer.skip'));

    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
    expect(mocks.addPasskey).not.toHaveBeenCalled();

    cleanup();
    render(app());
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
  });

  it('checks once per signed-in user however often it re-renders', async () => {
    const view = render(app());
    await screen.findByTestId('passkey-offer');

    view.rerender(app());
    view.rerender(app());

    expect(mocks.listPasskeys).toHaveBeenCalledOnce();
  });
});
