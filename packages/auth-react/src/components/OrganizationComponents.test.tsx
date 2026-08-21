// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const currentUser = {
    id: 'user-owner',
    email: 'owner@example.test',
    emailVerified: true,
    name: 'Owner Mona',
    image: null,
    createdAt: new Date('2026-07-14T08:00:00.000Z'),
    updatedAt: new Date('2026-07-14T08:00:00.000Z'),
  };
  const currentMember = {
    id: 'member-owner',
    organizationId: 'org-cairo',
    userId: currentUser.id,
    role: 'owner',
    createdAt: new Date('2026-07-14T08:00:00.000Z'),
    user: { id: currentUser.id, name: currentUser.name, email: currentUser.email, image: null },
  };
  const teammate = {
    id: 'member-teammate',
    organizationId: 'org-cairo',
    userId: 'user-teammate',
    role: 'member',
    createdAt: new Date('2026-07-14T08:30:00.000Z'),
    user: { id: 'user-teammate', name: 'Youssef Ali', email: 'youssef@example.test', image: null },
  };
  const pendingInvitation = {
    id: 'invitation-pending',
    organizationId: 'org-cairo',
    email: 'new@example.test',
    role: 'member',
    status: 'pending' as const,
    inviterId: currentUser.id,
    expiresAt: new Date('2026-07-21T08:00:00.000Z'),
    createdAt: new Date('2026-07-14T09:00:00.000Z'),
  };
  const cairo = {
    id: 'org-cairo',
    name: 'Cairo Studio',
    slug: 'cairo-studio',
    logo: null,
    metadata: null,
    createdAt: new Date('2026-07-14T08:00:00.000Z'),
    members: [currentMember, teammate],
    invitations: [pendingInvitation],
  };
  const delta = {
    id: 'org-delta',
    name: 'Delta Group',
    slug: 'delta-group',
    logo: null,
    metadata: null,
    createdAt: new Date('2026-07-14T08:00:00.000Z'),
  };
  const userInvitation = { ...pendingInvitation, id: 'invitation-user', organizationName: 'Alexandria Labs' };
  const mutationListeners = new Set<() => void>();
  const team = {
    id: 'team-core',
    name: 'Core',
    organizationId: 'org-cairo',
    createdAt: new Date('2026-07-14T10:00:00.000Z'),
  };
  const teamMember = {
    id: 'team-member-owner',
    teamId: team.id,
    userId: currentUser.id,
    createdAt: new Date('2026-07-14T10:05:00.000Z'),
  };
  const organization = {
    subscribe: (listener: () => void) => {
      mutationListeners.add(listener);
      return () => mutationListeners.delete(listener);
    },
    create: vi.fn(async () => {
      mutationListeners.forEach((listener) => listener());
      return { data: cairo, error: null };
    }),
    list: vi.fn(async () => ({ data: [cairo, delta], error: null })),
    get: vi.fn(async () => ({ data: cairo, error: null })),
    setActive: vi.fn(async () => ({ data: cairo, error: null })),
    createTeam: vi.fn(async () => ({ data: team, error: null })),
    listTeams: vi.fn(async () => ({ data: [team], error: null })),
    updateTeam: vi.fn(async () => ({ data: { ...team, name: 'Platform' }, error: null })),
    removeTeam: vi.fn(async () => ({ data: { message: 'Team removed successfully.' }, error: null })),
    listUserTeams: vi.fn(),
    listTeamMembers: vi.fn(async () => ({ data: [teamMember], error: null })),
    addTeamMember: vi.fn(async () => ({ data: { ...teamMember, id: 'team-member-teammate', userId: teammate.userId }, error: null })),
    removeTeamMember: vi.fn(async () => ({ data: { message: 'Team member removed successfully.' }, error: null })),
    setActiveTeam: vi.fn(),
    listRoles: vi.fn(async () => ({ data: [], error: null })),
    update: vi.fn(async () => ({ data: cairo, error: null })),
    delete: vi.fn(async () => ({ data: cairo, error: null })),
    listMembers: vi.fn(),
    inviteMember: vi.fn(async () => ({ data: pendingInvitation, error: null })),
    listInvitations: vi.fn(async () => ({ data: [pendingInvitation], error: null })),
    listUserInvitations: vi.fn(async () => ({ data: [userInvitation], error: null })),
    getInvitation: vi.fn(),
    acceptInvitation: vi.fn(async () => ({ data: { invitation: userInvitation, member: teammate }, error: null })),
    rejectInvitation: vi.fn(async () => ({ data: { invitation: userInvitation, member: null }, error: null })),
    cancelInvitation: vi.fn(async () => ({ data: pendingInvitation, error: null })),
    removeMember: vi.fn(async () => ({ data: { member: teammate }, error: null })),
    updateMemberRole: vi.fn(async () => ({ data: { ...teammate, role: 'owner' }, error: null })),
    leave: vi.fn(async () => ({ data: currentMember, error: null })),
  };
  return {
    currentUser,
    currentMember,
    cairo,
    delta,
    team,
    teamMember,
    organization,
    config: { organizations: true },
    session: { activeOrganizationId: 'org-cairo' as string | null },
    refetch: vi.fn(async () => undefined),
    serverError: vi.fn((_error: unknown, fallback: string) => fallback),
    translate: (key: string, params?: Record<string, string | number>) => {
      let message = key;
      for (const [name, value] of Object.entries(params ?? {})) message = message.replace(`{${name}}`, String(value));
      return message;
    },
  };
});

vi.mock('../hooks', () => ({
  useAuthClient: () => ({ organization: mocks.organization }),
  usePublicConfig: () => ({ config: mocks.config, isLoading: false, isError: false }),
  useUser: () => ({ user: mocks.currentUser, isLoaded: true, isSignedIn: true, needsMfaEnrollment: false, error: null }),
  useSession: () => ({
    data: { user: mocks.currentUser, session: { id: 'session-1', userId: mocks.currentUser.id, activeOrganizationId: mocks.session.activeOrganizationId } },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));

vi.mock('../i18n', () => ({
  Bidi: ({ children }: { children: React.ReactNode }) => <bdi>{children}</bdi>,
  useServerError: () => mocks.serverError,
  useT: () => mocks.translate,
}));

import { CreateOrganization } from './CreateOrganization';
import { OrganizationList } from './OrganizationList';
import { OrganizationProfile } from './OrganizationProfile';
import { OrganizationSwitcher } from './OrganizationSwitcher';

describe('organization components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.organizations = true;
    mocks.session.activeOrganizationId = 'org-cairo';
    mocks.currentMember.role = 'owner';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('hides every organization surface when the server capability is off', async () => {
    mocks.config.organizations = false;
    const { container } = render(<><OrganizationSwitcher /><OrganizationList /><CreateOrganization /><OrganizationProfile /></>);

    await waitFor(() => expect(container.textContent).toBe(''));
    expect(mocks.organization.list).not.toHaveBeenCalled();
    expect(mocks.organization.get).not.toHaveBeenCalled();
  });

  it('derives a slug and creates an organization', async () => {
    const onCreated = vi.fn();
    render(<CreateOrganization onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('organization.create.name'), { target: { value: 'Cairo Labs' } });
    expect(screen.getByLabelText('organization.create.slug')).toHaveProperty('value', 'cairo-labs');
    fireEvent.click(screen.getByRole('button', { name: 'organization.create.submit' }));

    await waitFor(() => expect(mocks.organization.create).toHaveBeenCalledWith({ name: 'Cairo Labs', slug: 'cairo-labs', logo: null }));
    expect(onCreated).toHaveBeenCalledWith(mocks.cairo);
  });

  it('refreshes a mounted switcher after creating an organization', async () => {
    mocks.organization.list
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [mocks.cairo], error: null });
    render(<><OrganizationSwitcher /><CreateOrganization /></>);

    await screen.findByRole('button', { name: /organization.personal/ });
    fireEvent.change(screen.getByLabelText('organization.create.name'), {
      target: { value: 'Cairo Studio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'organization.create.submit' }));

    await waitFor(() => expect(mocks.organization.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /Cairo Studio/ })).toBeTruthy();
  });

  it('switches the active organization and refreshes the session', async () => {
    render(<OrganizationSwitcher />);
    const trigger = await screen.findByRole('button', { name: /Cairo Studio/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Delta Group/ }));

    await waitFor(() => expect(mocks.organization.setActive).toHaveBeenCalledWith({ organizationId: 'org-delta' }));
    expect(mocks.refetch).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
  });

  it('supports arrow-key menu navigation and restores focus after closing a dialog', async () => {
    render(<OrganizationSwitcher />);
    const trigger = await screen.findByRole('button', { name: /Cairo Studio/ });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'organization.personal' })));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'organization.switcher.create' }));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'organization.create.title' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  /**
   * A failed load is not an empty directory. The list used to render "you do not
   * belong to an organization yet" underneath the error, which is a claim it
   * cannot make when the request never answered - and it buries the retry that
   * is the actual next step.
   */
  it('does not claim an empty directory when the organizations failed to load', async () => {
    // The mock is typed from its happy-path default, so the failure envelope -
    // the shape the client really returns on an error - needs the cast.
    mocks.organization.list.mockResolvedValueOnce({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'nope' },
    } as never);
    render(<OrganizationList />);

    await screen.findByText('organization.error.load');
    expect(screen.queryByText('organization.list.empty')).toBeNull();
    // The retry stays reachable: it is what resolves the state the user is in.
    expect(screen.getByRole('button', { name: 'organization.retry' })).toBeTruthy();
  });

  it('does not claim there are no invitations when invitations failed to load', async () => {
    mocks.organization.listUserInvitations.mockResolvedValueOnce({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'nope' },
    } as never);
    render(<OrganizationList />);

    await screen.findByText('organization.list.invitationsError');
    expect(screen.queryByText('organization.list.noInvitations')).toBeNull();
    expect(screen.getByRole('button', { name: 'organization.retry' })).toBeTruthy();
  });

  it('keeps already-loaded invitations visible when a later refetch fails', async () => {
    // Data-first, matching the organizations section: an error never hides a list
    // that did load. Only the empty state is suppressed, because that is the claim
    // a failed load cannot make.
    render(<OrganizationList />);
    await screen.findByText('Alexandria Labs');

    mocks.organization.listUserInvitations.mockResolvedValueOnce({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'nope' },
    } as never);
    fireEvent.click(screen.getByRole('button', { name: 'organization.list.reject' }));

    await screen.findByText('organization.list.invitationsError');
    expect(screen.getByText('Alexandria Labs')).toBeTruthy();
    expect(screen.queryByText('organization.list.noInvitations')).toBeNull();
  });

  it('accepts a pending invitation from the organization list', async () => {
    render(<OrganizationList />);
    fireEvent.click(await screen.findByRole('button', { name: 'organization.list.accept' }));

    await waitFor(() => expect(mocks.organization.acceptInvitation).toHaveBeenCalledWith({ invitationId: 'invitation-user' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('drives details, ownership promotion, invitations, and deletion from the profile', async () => {
    const onDeleted = vi.fn();
    render(<OrganizationProfile organizationId="org-cairo" onDeleted={onDeleted} />);
    await screen.findByRole('heading', { name: 'Cairo Studio' });

    fireEvent.change(screen.getByLabelText('organization.create.name'), { target: { value: 'Cairo Studio Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.general.save' }));
    await waitFor(() => expect(mocks.organization.update).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-cairo' })));

    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.nav.members' }));
    fireEvent.change(screen.getByLabelText('organization.profile.members.role'), { target: { value: 'owner' } });
    await waitFor(() => expect(mocks.organization.updateMemberRole).toHaveBeenCalledWith({ organizationId: 'org-cairo', memberId: 'member-teammate', role: 'owner' }));

    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.nav.invitations' }));
    fireEvent.change(screen.getByLabelText('organization.profile.invitations.email'), { target: { value: 'team@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.invitations.invite' }));
    await waitFor(() => expect(mocks.organization.inviteMember).toHaveBeenCalledWith({ organizationId: 'org-cairo', email: 'team@example.test', role: 'member' }));

    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.nav.danger' }));
    fireEvent.change(screen.getByLabelText(/organization.profile.danger.deleteConfirm/), { target: { value: 'cairo-studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.danger.delete' }));
    await waitFor(() => expect(mocks.organization.delete).toHaveBeenCalledWith({ organizationId: 'org-cairo' }));
    expect(onDeleted).toHaveBeenCalledWith(mocks.cairo);
  });

  it('hides manager-only invitations and deletion from a regular member', async () => {
    mocks.currentMember.role = 'member';
    render(<OrganizationProfile organizationId="org-cairo" />);
    await screen.findByRole('heading', { name: 'Cairo Studio' });

    expect(screen.queryByRole('button', { name: 'organization.profile.nav.invitations' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.nav.danger' }));
    expect(screen.queryByRole('button', { name: 'organization.profile.danger.delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'organization.profile.danger.leave' })).toBeTruthy();
  });

  it('creates, renames, removes, and manages members in profile teams', async () => {
    const productTeam = { ...mocks.team, id: 'team-product', name: 'Product' };
    const renamedTeam = { ...mocks.team, name: 'Platform' };
    const teammateTeamMember = {
      ...mocks.teamMember,
      id: 'team-member-teammate',
      userId: 'user-teammate',
    };
    mocks.organization.listTeams
      .mockResolvedValueOnce({ data: [mocks.team], error: null })
      .mockResolvedValueOnce({ data: [mocks.team, productTeam], error: null })
      .mockResolvedValueOnce({ data: [renamedTeam, productTeam], error: null })
      .mockResolvedValueOnce({ data: [productTeam], error: null });
    mocks.organization.listTeamMembers
      .mockResolvedValueOnce({ data: [mocks.teamMember], error: null })
      .mockResolvedValueOnce({ data: [mocks.teamMember, teammateTeamMember], error: null })
      .mockResolvedValueOnce({ data: [teammateTeamMember], error: null });
    render(<OrganizationProfile organizationId="org-cairo" defaultSection="teams" />);

    await screen.findByRole('heading', { name: 'organization.profile.teams.title' });
    await waitFor(() => expect(mocks.organization.listTeams).toHaveBeenCalledWith({ organizationId: 'org-cairo' }));

    fireEvent.change(screen.getByLabelText('organization.profile.teams.create'), { target: { value: 'Product' } });
    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.teams.create' }));
    await waitFor(() => expect(mocks.organization.createTeam).toHaveBeenCalledWith({ organizationId: 'org-cairo', name: 'Product' }));
    await screen.findByText('Product');

    const coreRow = screen.getByText('Core').closest('li')!;
    fireEvent.click(within(coreRow).getByRole('button', { name: 'organization.profile.teams.rename' }));
    fireEvent.change(screen.getByLabelText('organization.profile.teams.rename'), { target: { value: 'Platform' } });
    fireEvent.click(within(coreRow).getByRole('button', { name: 'organization.profile.teams.rename' }));
    await waitFor(() => expect(mocks.organization.updateTeam).toHaveBeenCalledWith({
      teamId: 'team-core',
      data: { name: 'Platform', organizationId: 'org-cairo' },
    }));
    await screen.findByText('Platform');

    const platformRow = screen.getByText('Platform').closest('li')!;
    fireEvent.click(within(platformRow).getByRole('button', { name: 'organization.profile.teams.manageMembers' }));
    await waitFor(() => expect(mocks.organization.listTeamMembers).toHaveBeenCalledWith({ teamId: 'team-core' }));
    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.teams.addMember' }));
    await waitFor(() => expect(mocks.organization.addTeamMember).toHaveBeenCalledWith({
      teamId: 'team-core',
      userId: 'user-teammate',
      organizationId: 'org-cairo',
    }));
    await waitFor(() => expect(screen.getByText('Youssef Ali').closest('li')).not.toBeNull());

    const ownerRow = screen.getByText('Owner Mona').closest('li')!;
    fireEvent.click(within(ownerRow).getByRole('button', { name: 'organization.profile.teams.removeMember' }));
    await waitFor(() => expect(mocks.organization.removeTeamMember).toHaveBeenCalledWith({
      teamId: 'team-core',
      userId: 'user-owner',
      organizationId: 'org-cairo',
    }));
    await waitFor(() => expect(ownerRow.isConnected).toBe(false));

    fireEvent.click(within(platformRow).getByRole('button', { name: 'organization.profile.teams.removeTeam' }));
    await waitFor(() => expect(mocks.organization.removeTeam).toHaveBeenCalledWith({ teamId: 'team-core', organizationId: 'org-cairo' }));
    await waitFor(() => expect(screen.queryByText('Platform')).toBeNull());
    expect(screen.getByText('Product')).toBeTruthy();
  });

  it('keeps team writes gated for a regular organization member', async () => {
    mocks.currentMember.role = 'member';
    render(<OrganizationProfile organizationId="org-cairo" defaultSection="teams" />);

    await screen.findByRole('heading', { name: 'organization.profile.teams.title' });
    expect(screen.queryByLabelText('organization.profile.teams.create')).toBeNull();
    expect(screen.queryByRole('button', { name: 'organization.profile.teams.rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'organization.profile.teams.removeTeam' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'organization.profile.teams.manageMembers' }));
    await waitFor(() => expect(mocks.organization.listTeamMembers).toHaveBeenCalledWith({ teamId: 'team-core' }));
    expect(screen.queryByRole('button', { name: 'organization.profile.teams.addMember' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'organization.profile.teams.removeMember' })).toBeNull();
  });

  it('gates each team action from custom-role permissions instead of role names', async () => {
    mocks.currentMember.role = 'team_builder';
    mocks.organization.listRoles.mockResolvedValueOnce({
      data: [{
        role: 'team_builder',
        permission: { team: ['create', 'update'], member: ['update'] },
      }],
      error: null,
    } as never);
    render(<OrganizationProfile organizationId="org-cairo" defaultSection="teams" />);

    await screen.findByRole('heading', { name: 'organization.profile.teams.title' });
    await waitFor(() => expect(mocks.organization.listRoles).toHaveBeenCalledWith({ organizationId: 'org-cairo' }));
    expect(screen.getByLabelText('organization.profile.teams.create')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'organization.profile.teams.rename' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'organization.profile.teams.removeTeam' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.teams.manageMembers' }));
    await screen.findByRole('button', { name: 'organization.profile.teams.addMember' });
    expect(screen.queryByRole('button', { name: 'organization.profile.teams.removeMember' })).toBeNull();
  });

  it('keeps the last good team list visible when a post-mutation refresh fails', async () => {
    mocks.organization.listTeams
      .mockResolvedValueOnce({ data: [mocks.team], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'INTERNAL_ERROR', message: 'nope' } } as never);
    render(<OrganizationProfile organizationId="org-cairo" defaultSection="teams" />);

    await screen.findByText('Core');
    fireEvent.change(screen.getByLabelText('organization.profile.teams.create'), { target: { value: 'Product' } });
    fireEvent.click(screen.getByRole('button', { name: 'organization.profile.teams.create' }));

    await screen.findByText('organization.profile.loadError');
    expect(screen.getByText('Core')).toBeTruthy();
  });

  it('distinguishes a team load failure from an empty team list and retries', async () => {
    let resolveRetry!: (result: { data: never[]; error: null }) => void;
    mocks.organization.listTeams
      .mockResolvedValueOnce({ data: null, error: { code: 'INTERNAL_ERROR', message: 'nope' } } as never)
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRetry = resolve;
      }));
    render(<OrganizationProfile organizationId="org-cairo" defaultSection="teams" />);

    await screen.findByText('organization.profile.loadError');
    fireEvent.click(screen.getByRole('button', { name: 'organization.retry' }));
    expect(screen.getByLabelText('common.loading')).toBeTruthy();
    expect(screen.queryByText('organization.profile.teams.empty')).toBeNull();
    resolveRetry({ data: [], error: null });
    await screen.findByText('organization.profile.teams.empty');
    expect(mocks.organization.listTeams).toHaveBeenCalledTimes(2);
  });
});
