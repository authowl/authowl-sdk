import { describe, expect, it } from 'vitest';
import type { OrganizationMember } from '@authowl/core';
import {
  canManageOrganization,
  hasOrganizationRole,
  organizationRoles,
  organizationSlugFromName,
  teamManagementCapabilities,
} from './model';

describe('organization component model', () => {
  it('normalizes a safe public slug', () => {
    expect(organizationSlugFromName('  Cairo Studio & Labs  ')).toBe('cairo-studio-labs');
    expect(organizationSlugFromName('---')).toBe('');
  });

  it('recognizes comma-separated organization roles', () => {
    const membership: OrganizationMember = {
      id: 'member-1',
      organizationId: 'organization-1',
      userId: 'user-1',
      role: 'member, owner',
      createdAt: new Date('2026-07-14T08:00:00.000Z'),
    };
    expect(organizationRoles(membership.role)).toEqual(['member', 'owner']);
    expect(hasOrganizationRole(membership, 'owner')).toBe(true);
    expect(canManageOrganization(membership)).toBe(true);
  });

  it('derives each team action from the matching custom-role statements', () => {
    const membership: OrganizationMember = {
      id: 'member-1',
      organizationId: 'organization-1',
      userId: 'user-1',
      role: 'team_builder',
      createdAt: new Date('2026-07-14T08:00:00.000Z'),
    };

    expect(teamManagementCapabilities(membership, [{
      role: 'team_builder',
      permission: {
        team: ['create', 'update'],
        member: ['update'],
      },
    }])).toEqual({
      createTeam: true,
      updateTeam: true,
      deleteTeam: false,
      addTeamMember: true,
      removeTeamMember: false,
    });
  });
});
