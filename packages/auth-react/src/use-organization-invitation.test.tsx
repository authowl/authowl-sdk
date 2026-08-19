// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Blocker 07: the emailed invitation link produced no membership. The link lands
 * on the OPERATOR'S page carrying `?authowl_invitation=<id>`, and until now
 * nothing read it - so the invitee signed up and simply never joined.
 *
 * These cover the two halves that make it work: the claim outliving the sign-up
 * it has to wait for, and every way accepting can fail being SHOWN rather than
 * swallowed. The second half is why the prompt is confirmed rather than
 * automatic - an auto-accept has nowhere to render a cap, an expiry, or a
 * wrong-account refusal, which is this same defect one layer up.
 */

const mocks = vi.hoisted(() => ({
  session: {
    data: {
      session: {
        id: 's1',
        userId: 'user-1',
        activeOrganizationId: null as string | null,
        activeTeamId: null as string | null,
        membership: null as unknown,
      },
      user: { id: 'user-1' as string | null },
    },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  },
  getInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  setActive: vi.fn(async () => ({ data: {}, error: null })),
  signOut: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock('./provider', () => ({
  useAuthOwlContext: () => ({
    client: {
      sessionStore: {
        subscribe: () => () => undefined,
        getSnapshot: () => mocks.session,
      },
      organization: {
        getInvitation: mocks.getInvitation,
        acceptInvitation: mocks.acceptInvitation,
        setActive: mocks.setActive,
      },
      signOut: mocks.signOut,
    },
    config: { organizations: true },
    configState: 'ready',
    locale: 'en',
  }),
  useAuthClient: () => ({
    organization: {
      getInvitation: mocks.getInvitation,
      acceptInvitation: mocks.acceptInvitation,
      setActive: mocks.setActive,
    },
    signOut: mocks.signOut,
  }),
}));

import { captureInvitationClaim, readInvitationClaim } from '@authowl/core';
import { InvitationPrompt } from './components/InvitationPrompt';

const invitationDetails = {
  id: 'inv_1',
  organizationId: 'org-1',
  organizationName: 'Acme Inc',
  organizationSlug: 'acme',
  email: 'invitee@example.com',
  role: 'member',
  status: 'pending' as const,
  inviterId: 'user-9',
  inviterEmail: 'owner@example.com',
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
};

function stash(id = 'inv_1'): void {
  window.history.replaceState({}, '', `/team?authowl_invitation=${id}`);
  captureInvitationClaim();
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/team');
  mocks.session.data.user.id = 'user-1';
  mocks.session.data.session.activeOrganizationId = null;
  mocks.getInvitation.mockReset();
  mocks.acceptInvitation.mockReset();
  mocks.setActive.mockReset();
  mocks.setActive.mockResolvedValue({ data: {}, error: null });
});

afterEach(cleanup);

describe('InvitationPrompt', () => {
  it('offers the organization by name and joins on confirmation', async () => {
    stash();
    mocks.getInvitation.mockResolvedValue({ data: invitationDetails, error: null });
    mocks.acceptInvitation.mockResolvedValue({
      data: { invitation: invitationDetails, member: { id: 'm1', organizationId: 'org-1' } },
      error: null,
    });
    render(<InvitationPrompt />);

    const join = await screen.findByRole('button', { name: 'Join organization' });
    expect(screen.getByText('Join Acme Inc to work with your team.')).toBeTruthy();
    join.click();

    await waitFor(() => expect(mocks.acceptInvitation).toHaveBeenCalledWith({ invitationId: 'inv_1' }));
    // Consumed: a refresh must not re-offer an invitation already accepted.
    await waitFor(() => expect(readInvitationClaim()).toBeNull());
    // A fresh invitee has nowhere else to be, so the new org becomes active.
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: 'org-1' });
  });

  it('never yanks an existing active organization', async () => {
    stash();
    mocks.session.data.session.activeOrganizationId = 'org-existing';
    mocks.getInvitation.mockResolvedValue({ data: invitationDetails, error: null });
    mocks.acceptInvitation.mockResolvedValue({
      data: { invitation: invitationDetails, member: { id: 'm1', organizationId: 'org-1' } },
      error: null,
    });
    render(<InvitationPrompt />);

    (await screen.findByRole('button', { name: 'Join organization' })).click();
    await waitFor(() => expect(mocks.acceptInvitation).toHaveBeenCalled());
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it('explains a wrong-account refusal without naming the invited address', async () => {
    stash();
    mocks.getInvitation.mockResolvedValue({
      data: null,
      error: { code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', message: 'no' },
    });
    render(<InvitationPrompt />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('different email address');
    // Recipient-only stays recipient-only: the address is never rendered.
    expect(document.body.textContent).not.toContain('invitee@example.com');
    // The invitation is still theirs from the right account, so signing out
    // must not discard it.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(readInvitationClaim()).not.toBeNull();
  });

  it('surfaces a failure to accept instead of reporting success', async () => {
    stash();
    mocks.getInvitation.mockResolvedValue({ data: invitationDetails, error: null });
    mocks.acceptInvitation.mockResolvedValue({
      data: null,
      error: { code: 'MEMBER_LIMIT_REACHED', message: 'full' },
    });
    render(<InvitationPrompt />);

    (await screen.findByRole('button', { name: 'Join organization' })).click();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not accept');
    // Still claimable: the cap may be raised, and the user can retry.
    expect(readInvitationClaim()).not.toBeNull();
  });

  it('dismisses locally and never rejects the invitation server-side', async () => {
    stash();
    mocks.getInvitation.mockResolvedValue({ data: invitationDetails, error: null });
    render(<InvitationPrompt />);

    (await screen.findByRole('button', { name: 'Not now' })).click();

    await waitFor(() => expect(readInvitationClaim()).toBeNull());
    expect(screen.queryByRole('button', { name: 'Join organization' })).toBeNull();
  });

  it('stays silent until there is a session to redeem with', async () => {
    stash();
    mocks.session.data.user.id = null;
    render(<InvitationPrompt />);

    await waitFor(() => expect(mocks.getInvitation).not.toHaveBeenCalled());
    expect(screen.queryByTestId('authowl-invitation-prompt')).toBeNull();
    // And the claim waits for the sign-up rather than being spent.
    expect(readInvitationClaim()).not.toBeNull();
  });
});
