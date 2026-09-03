// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@authowl/core';

const mocks = vi.hoisted(() => ({
  config: null as PublicConfig | null,
  user: null as { id: string; twoFactorEnabled: boolean } | null,
  sessionId: null as string | null,
  listPasskeys: vi.fn(async (): Promise<{ data: unknown[] | null; error: unknown }> => ({
    data: [],
    error: null,
  })),
  addPasskey: vi.fn(async () => ({ data: { id: 'passkey-1' }, error: null })),
}));

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useUser: () => ({ user: mocks.user, isSignedIn: mocks.user !== null }),
  useSession: () => ({
    data: mocks.user && mocks.sessionId
      ? { user: mocks.user, session: { id: mocks.sessionId } }
      : null,
    isPending: false,
    error: null,
  }),
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
    mocks.sessionId = 'session-1';
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

  it('gives the app back if the session ends while the offer is up', async () => {
    const view = render(app());
    await screen.findByTestId('passkey-offer');

    // Revoked in another tab, expired, or signed out elsewhere. Holding the
    // offer up would cover the app - including any redirect to sign-in - with
    // a prompt whose addPasskey() can now only fail.
    mocks.user = null;
    view.rerender(app());

    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('still offers under StrictMode, which double-invokes the effect', async () => {
    // A check-once guard that survives the simulated remount would set itself on
    // the first run, have that run's result discarded as cancelled, and
    // early-return on the second - so the offer would never appear in any
    // consumer's dev environment.
    render(
      <React.StrictMode>
        <PasskeyOfferGate><p>the app</p></PasskeyOfferGate>
      </React.StrictMode>,
    );

    expect(await screen.findByTestId('passkey-offer')).toBeTruthy();
  });

  it('does not show one account the offer decided for another', async () => {
    // A second tab signing in as someone else propagates here without an
    // unmount. Keyed by a bare flag, user 1's offer re-rendered for user 2
    // before user 2 had been checked at all - and user 2's answer, when it
    // arrived, could not close it.
    const view = render(app());
    await screen.findByTestId('passkey-offer');

    mocks.listPasskeys.mockResolvedValue({ data: [{ id: 'passkey-2' }], error: null });
    mocks.user = { id: 'user-2', twoFactorEnabled: false };
    view.rerender(app());

    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('does not flash a stale offer when switching back to the first account', async () => {
    // A -> B -> A is one person with two accounts, not an exotic case. If a
    // "not due" answer could only fail to open an offer rather than close one,
    // B's "no" would leave A's offer still recorded, and returning to A would
    // render it instantly - before A had been re-checked.
    const view = render(app());
    await screen.findByTestId('passkey-offer');

    mocks.listPasskeys.mockResolvedValue({ data: [{ id: 'passkey-2' }], error: null });
    mocks.user = { id: 'user-2', twoFactorEnabled: false };
    mocks.sessionId = 'session-2';
    view.rerender(app());
    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalledTimes(2));

    mocks.user = { id: 'user-1', twoFactorEnabled: false };
    mocks.sessionId = 'session-3';
    view.rerender(app());

    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('does not reuse an old offer during a rapid account switch back', async () => {
    const view = render(app());
    await screen.findByTestId('passkey-offer');

    let resolveSecondCheck: (value: { data: unknown[]; error: null }) => void = () => {};
    let resolveThirdCheck: (value: { data: unknown[]; error: null }) => void = () => {};
    mocks.listPasskeys
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondCheck = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveThirdCheck = resolve;
      }));

    mocks.user = { id: 'user-2', twoFactorEnabled: false };
    mocks.sessionId = 'session-2';
    view.rerender(app());
    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalledTimes(2));

    // Return to the first account before either replacement check settles. A
    // user-only key matches the old decision here and flashes the stale offer.
    mocks.user = { id: 'user-1', twoFactorEnabled: false };
    mocks.sessionId = 'session-3';
    view.rerender(app());

    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    expect(screen.getByText('the app')).toBeTruthy();
    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId('passkey-offer')).toBeNull();

    resolveSecondCheck({ data: [], error: null });
    resolveThirdCheck({ data: [{ id: 'already-added' }], error: null });
    await waitFor(() => expect(screen.queryByTestId('passkey-offer')).toBeNull());
  });

  it('offers the new account when it qualifies on its own', async () => {
    const view = render(app());
    await screen.findByTestId('passkey-offer');

    mocks.user = { id: 'user-2', twoFactorEnabled: false };
    mocks.sessionId = 'session-2';
    view.rerender(app());

    // Shown again only because user-2's own check said so.
    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('passkey-offer')).toBeTruthy();
  });

  it('checks once per signed-in user however often it re-renders', async () => {
    const view = render(app());
    await screen.findByTestId('passkey-offer');

    view.rerender(app());
    view.rerender(app());

    expect(mocks.listPasskeys).toHaveBeenCalledOnce();
  });
});
