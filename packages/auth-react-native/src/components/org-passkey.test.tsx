// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listOrgs, setActive, addPasskey, signInPasskey, sessionState, nativeClient } = vi.hoisted(() => {
  const listOrgs = vi.fn();
  const setActive = vi.fn();
  const addPasskey = vi.fn();
  const signInPasskey = vi.fn();
  return {
    listOrgs,
    setActive,
    addPasskey,
    signInPasskey,
    sessionState: { value: {} as Record<string, unknown> },
    nativeClient: {
      organization: { list: listOrgs, setActive },
      passkey: { addPasskey },
      signIn: { passkey: signInPasskey },
    },
  };
});

vi.mock('../provider', () => ({
  useAuthOwlClient: () => nativeClient,
  useSession: () => sessionState.value,
  usePublicConfig: () => ({ data: null, isLoading: false, state: 'error' }),
  useAuthOwlLocale: () => 'en',
}));

import { OrganizationSwitcher } from './OrganizationSwitcher';
import { PasskeyEnrollment, PasskeySignInButton } from './PasskeyEnrollment';

const byId = (id: string) => screen.getByTestId(id) as HTMLElement;
const button = (id: string) => byId(id) as HTMLButtonElement;

function signedIn(activeOrganizationId: string | null = null) {
  sessionState.value = {
    data: { user: { id: 'u1' }, session: { id: 's1', activeOrganizationId } },
    isPending: false,
  };
}

function signedInAs(userId: string) {
  sessionState.value = {
    data: { user: { id: userId }, session: { id: `s-${userId}`, activeOrganizationId: null } },
    isPending: false,
  };
}

const acme = { id: 'org_1', name: 'Acme', slug: 'acme', createdAt: new Date() };
const globex = { id: 'org_2', name: 'Globex', slug: 'globex', createdAt: new Date() };

afterEach(cleanup);

describe('<OrganizationSwitcher />', () => {
  beforeEach(() => {
    listOrgs.mockReset();
    setActive.mockReset();
    signedIn();
  });

  it('does not fetch organizations while signed out', async () => {
    sessionState.value = { data: null, isPending: false };
    render(<OrganizationSwitcher />);
    // Organizations are per-user; an anonymous fetch could only 401.
    expect(listOrgs).not.toHaveBeenCalled();
  });

  it('lists the caller organizations', async () => {
    listOrgs.mockResolvedValue({ data: [acme, globex], error: null });
    render(<OrganizationSwitcher />);

    await waitFor(() => expect(byId('authowl-orgswitcher-org_1')).toBeTruthy());
    expect(byId('authowl-orgswitcher-org_2')).toBeTruthy();
  });

  it('marks the active organization as already selected', async () => {
    listOrgs.mockResolvedValue({ data: [acme, globex], error: null });
    signedIn('org_1');
    render(<OrganizationSwitcher />);

    await waitFor(() => expect(button('authowl-orgswitcher-org_1').disabled).toBe(true));
    expect(button('authowl-orgswitcher-org_2').disabled).toBe(false);
  });

  it('switches by id and reports the new organization', async () => {
    listOrgs.mockResolvedValue({ data: [acme, globex], error: null });
    setActive.mockResolvedValue({ data: globex, error: null });
    const onSwitched = vi.fn();
    render(<OrganizationSwitcher onSwitched={onSwitched} />);

    await waitFor(() => expect(byId('authowl-orgswitcher-org_2')).toBeTruthy());
    fireEvent.click(button('authowl-orgswitcher-org_2'));

    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ organizationId: 'org_2' }));
    expect(onSwitched).toHaveBeenCalledWith(globex);
  });

  it('clears the active organization when personal is allowed', async () => {
    listOrgs.mockResolvedValue({ data: [acme], error: null });
    setActive.mockResolvedValue({ data: null, error: null });
    signedIn('org_1');
    render(<OrganizationSwitcher allowPersonal />);

    await waitFor(() => expect(byId('authowl-orgswitcher-personal')).toBeTruthy());
    fireEvent.click(button('authowl-orgswitcher-personal'));

    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ organizationId: null }));
  });

  it('hides the personal row by default, since many apps require an org', async () => {
    listOrgs.mockResolvedValue({ data: [acme], error: null });
    render(<OrganizationSwitcher />);

    await waitFor(() => expect(byId('authowl-orgswitcher-org_1')).toBeTruthy());
    expect(screen.queryByTestId('authowl-orgswitcher-personal')).toBeNull();
  });

  it('offers a retry when loading fails', async () => {
    listOrgs.mockResolvedValue({ data: null, error: { code: 'INTERNAL' } });
    render(<OrganizationSwitcher />);

    await waitFor(() => expect(byId('authowl-orgswitcher-error')).toBeTruthy());
    listOrgs.mockResolvedValue({ data: [acme], error: null });
    fireEvent.click(byId('authowl-orgswitcher-retry'));

    await waitFor(() => expect(byId('authowl-orgswitcher-org_1')).toBeTruthy());
  });

  it('clears and reloads organizations when the signed-in user changes', async () => {
    listOrgs
      .mockResolvedValueOnce({ data: [acme], error: null })
      .mockResolvedValueOnce({ data: [globex], error: null });
    signedInAs('u1');
    const view = render(<OrganizationSwitcher />);
    await waitFor(() => expect(byId('authowl-orgswitcher-org_1')).toBeTruthy());

    signedInAs('u2');
    view.rerender(<OrganizationSwitcher />);

    await waitFor(() => expect(listOrgs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(byId('authowl-orgswitcher-org_2')).toBeTruthy());
    expect(screen.queryByTestId('authowl-orgswitcher-org_1')).toBeNull();
  });
});

describe('passkey components', () => {
  beforeEach(() => {
    addPasskey.mockReset();
    signInPasskey.mockReset();
    signedIn();
  });

  it('enrols a passkey and reports success', async () => {
    addPasskey.mockResolvedValue({ data: { id: 'pk_1' }, error: null });
    const onEnrolled = vi.fn();
    render(<PasskeyEnrollment name="iPhone" onEnrolled={onEnrolled} />);
    fireEvent.click(button('authowl-passkey-submit'));

    await waitFor(() => expect(addPasskey).toHaveBeenCalledWith({ name: 'iPhone' }));
    expect(onEnrolled).toHaveBeenCalledTimes(1);
  });

  it('surfaces a cancelled prompt without reporting success', async () => {
    addPasskey.mockResolvedValue({
      data: null,
      error: { code: 'REGISTRATION_CANCELLED' },
    });
    const onEnrolled = vi.fn();
    render(<PasskeyEnrollment onEnrolled={onEnrolled} />);
    fireEvent.click(button('authowl-passkey-submit'));

    await waitFor(() => expect(byId('authowl-passkey-error')).toBeTruthy());
    expect(onEnrolled).not.toHaveBeenCalled();
  });

  it('only shows the skip link when the caller allows skipping', () => {
    const { rerender } = render(<PasskeyEnrollment />);
    expect(screen.queryByTestId('authowl-passkey-skip')).toBeNull();

    rerender(<PasskeyEnrollment onSkip={() => {}} />);
    expect(byId('authowl-passkey-skip')).toBeTruthy();
  });

  it('signs in with an enrolled passkey', async () => {
    signInPasskey.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const onSignedIn = vi.fn();
    render(<PasskeySignInButton onSignedIn={onSignedIn} />);
    fireEvent.click(button('authowl-passkey-signin-submit'));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });
});
