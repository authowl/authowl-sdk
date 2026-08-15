// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRoles: vi.fn(async () => ({ data: [{ role: 'billing_manager', permission: {} }], error: null })),
  updateMemberRole: vi.fn(async () => ({ data: {}, error: null })),
  removeMember: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock('../../hooks', () => ({
  useAuthClient: () => ({
    organization: {
      listRoles: mocks.listRoles,
      updateMemberRole: mocks.updateMemberRole,
      removeMember: mocks.removeMember,
    },
  }),
}));

vi.mock('../../i18n', () => ({
  Bidi: ({ children }: { children: React.ReactNode }) => <bdi>{children}</bdi>,
  useT: () => (key: string) => key,
  useServerError: () => (_error: unknown, fallback: string) => fallback,
}));

import { MembersSection } from './MembersSection';

const organization = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  createdAt: new Date(),
  members: [
    {
      id: 'member-teammate',
      organizationId: 'org-1',
      userId: 'user-teammate',
      role: 'member',
      createdAt: new Date(),
      user: { id: 'user-teammate', name: 'Youssef', email: 'y@example.test', image: null },
    },
  ],
  invitations: [],
} as unknown as React.ComponentProps<typeof MembersSection>['organization'];

function options(): string[] {
  const select = screen.getByLabelText('organization.profile.members.role') as HTMLSelectElement;
  return within(select).queryAllByRole('option').map((o) => (o as HTMLOptionElement).value);
}

describe('MembersSection role select source', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the server role list (built-ins + this project\'s roles)', async () => {
    render(<MembersSection organization={organization} userId="user-owner" canManage onChanged={vi.fn()} />);
    await waitFor(() => expect(mocks.listRoles).toHaveBeenCalledWith({ organizationId: 'org-1' }));
    await waitFor(() => expect(options()).toContain('billing_manager'));
    // Built-ins are always present, custom project role from the server appended.
    expect(options()).toEqual(expect.arrayContaining(['owner', 'admin', 'member', 'billing_manager']));
  });

  it('falls back to the three built-ins when list-roles is unavailable', async () => {
    mocks.listRoles.mockRejectedValueOnce(new Error('forbidden'));
    render(<MembersSection organization={organization} userId="user-owner" canManage onChanged={vi.fn()} />);
    await waitFor(() => expect(mocks.listRoles).toHaveBeenCalled());
    expect(options()).toEqual(['owner', 'admin', 'member']);
  });
});
