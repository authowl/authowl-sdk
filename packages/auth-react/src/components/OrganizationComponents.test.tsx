// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
  const organization = {
    create: vi.fn(async () => ({ data: cairo, error: null })),
    list: vi.fn(async () => ({ data: [cairo, delta], error: null })),
    get: vi.fn(async () => ({ data: cairo, error: null })),
    setActive: vi.fn(async () => ({ data: cairo, error: null })),
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
});
