// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationDetails } from '@authowl/core';

const membership = { role: 'billing_manager', permissions: ['org:billing:read', 'org:sys_roles:read'] };
const orgDetails: OrganizationDetails = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  createdAt: new Date('2026-07-14T08:00:00.000Z'),
  members: [],
  invitations: [],
};

// A member with no display name and a withheld email - both ordinary values:
// <SignUp> posts `name: ''` by default and the server redacts phone-only
// addresses. Typed as OrganizationDetails on purpose, so the public types have
// to admit this shape.
const namelessMemberOrg: OrganizationDetails = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  createdAt: new Date('2026-07-14T08:00:00.000Z'),
  members: [{
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    role: 'member',
    createdAt: new Date('2026-07-14T08:00:00.000Z'),
    user: { id: 'user-1', name: '', email: null },
  }],
  invitations: [],
};

const mocks = vi.hoisted(() => ({
  session: {
    data: {
      session: {
        id: 's1',
        userId: 'user-1',
        activeOrganizationId: 'org-1' as string | null,
        activeTeamId: null as string | null,
        membership: null as unknown,
      },
      user: { id: 'user-1' },
    },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  },
  get: vi.fn(async () => ({ data: orgDetails, error: null })),
}));

vi.mock('./provider', () => ({
  useAuthOwlContext: () => ({
    client: {
      sessionStore: {
        subscribe: () => () => undefined,
        getSnapshot: () => mocks.session,
      },
      organization: { get: mocks.get },
    },
    config: { organizations: true },
    configState: 'ready',
  }),
}));

import { useOrganization } from './hooks';

function Probe() {
  const {
    organization,
    membership: m,
    teams,
    activeTeamId,
    has,
    hasPermission,
    isLoaded,
  } = useOrganization();
  return (
    <div>
      <span data-testid="role">{m?.role ?? 'none'}</span>
      <span data-testid="has">{String(has({ permission: 'org:billing:read' }))}</span>
      <span data-testid="hasRole">{String(has({ role: 'billing_manager' }))}</span>
      <span data-testid="hasPerm">{String(hasPermission({ permission: 'org:billing:delete' }))}</span>
      <span data-testid="teams">{teams.join(',') || 'none'}</span>
      <span data-testid="activeTeam">{activeTeamId ?? 'none'}</span>
      <span data-testid="hasTeam">{String(has({ teamId: 'team-alpha' }))}</span>
      <span data-testid="org">{organization?.name ?? 'pending'}</span>
      <span data-testid="members">{organization ? String(organization.members.length) : 'none'}</span>
      <span data-testid="loaded">{String(isLoaded)}</span>
    </div>
  );
}

describe('useOrganization', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('returns membership + a has() bound to the active membership, and loads the active org', async () => {
    mocks.session.data.session.membership = membership;
    mocks.session.data.session.activeOrganizationId = 'org-1';
    render(<Probe />);

    expect(screen.getByTestId('role').textContent).toBe('billing_manager');
    // has() is bound to the session membership - a granted custom permission + role.
    expect(screen.getByTestId('has').textContent).toBe('true');
    expect(screen.getByTestId('hasRole').textContent).toBe('true');
    // An ungranted permission is false (evaluated locally, never over the network).
    expect(screen.getByTestId('hasPerm').textContent).toBe('false');

    await waitFor(() => expect(screen.getByTestId('org').textContent).toBe('Acme'));
    expect(mocks.get).toHaveBeenCalledWith({ organizationId: 'org-1' });
  });

  it('surfaces the session claim teams and the validated active team', async () => {
    // Distinct values from each other and from the org id, so wiring either field
    // to the wrong source (or hardcoding [] / null) fails rather than coincidentally
    // passing.
    mocks.session.data.session.membership = { ...membership, teams: ['team-alpha', 'team-beta'] };
    mocks.session.data.session.activeOrganizationId = 'org-1';
    mocks.session.data.session.activeTeamId = 'team-beta';
    render(<Probe />);

    expect(screen.getByTestId('teams').textContent).toBe('team-alpha,team-beta');
    expect(screen.getByTestId('activeTeam').textContent).toBe('team-beta');
    expect(screen.getByTestId('hasTeam').textContent).toBe('true');
  });

  it('reports no teams when the session claim predates teams', async () => {
    // The claim shape before teams shipped: no `teams` key at all. The hook must
    // report an empty list and DENY a team gate rather than treat absence as any-team.
    mocks.session.data.session.membership = membership;
    mocks.session.data.session.activeOrganizationId = 'org-1';
    mocks.session.data.session.activeTeamId = null;
    render(<Probe />);

    expect(screen.getByTestId('teams').textContent).toBe('none');
    expect(screen.getByTestId('activeTeam').textContent).toBe('none');
    expect(screen.getByTestId('hasTeam').textContent).toBe('false');
    // The role gate on that same claim still works.
    expect(screen.getByTestId('hasRole').textContent).toBe('true');
  });

  it('loads an organization whose member has no display name', async () => {
    // The decoder used to refuse an empty `name`, so `get()` failed and the hook
    // settled on isLoaded=true WITH organization=null while an active org was
    // set - a state its own contract forbids. Membership is unaffected either
    // way, which is what made the failure so confusing in the field.
    mocks.session.data.session.membership = membership;
    mocks.session.data.session.activeOrganizationId = 'org-1';
    mocks.get.mockResolvedValueOnce({ data: namelessMemberOrg, error: null });
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(screen.getByTestId('org').textContent).toBe('Acme');
    expect(screen.getByTestId('members').textContent).toBe('1');
  });

  it('returns null membership + false has() and skips the org fetch with no active org', async () => {
    mocks.session.data.session.membership = null;
    mocks.session.data.session.activeOrganizationId = null;
    render(<Probe />);

    expect(screen.getByTestId('role').textContent).toBe('none');
    expect(screen.getByTestId('has').textContent).toBe('false');
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
