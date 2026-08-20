import { describe, expect, it } from 'vitest';
import {
  createMembershipHas,
  membershipHas,
  membershipHasPermission,
  membershipHasTeam,
  type OrganizationMembership,
} from './organization-membership';

// A membership carrying BOTH a relabelled system claim (+ its legacy bare form,
// dual-emit) and a custom feature permission - exactly what the session/JWT emit.
const membership: OrganizationMembership = {
  role: 'billing_manager',
  permissions: [
    'member:create',
    'ac:read',
    'org:sys_memberships:create',
    'org:sys_roles:read',
    'org:billing:read',
    'org:billing:write',
  ],
};

describe('membershipHasPermission (pure, local claim)', () => {
  it('is true for a granted custom permission id', () => {
    expect(membershipHasPermission(membership, 'org:billing:read')).toBe(true);
  });

  it('is true for a granted system (org:sys_*) permission id', () => {
    expect(membershipHasPermission(membership, 'org:sys_memberships:create')).toBe(true);
  });

  it('is false for an ungranted permission id', () => {
    expect(membershipHasPermission(membership, 'org:billing:delete')).toBe(false);
    expect(membershipHasPermission(membership, 'org:sys_profile:delete')).toBe(false);
  });

  it('is false when there is no membership', () => {
    expect(membershipHasPermission(null, 'org:billing:read')).toBe(false);
    expect(membershipHasPermission(undefined, 'org:billing:read')).toBe(false);
  });
});

describe('membershipHasTeam (pure, local claim)', () => {
  const withTeams: OrganizationMembership = {
    ...membership,
    teams: ['team-alpha', 'team-beta'],
  };

  it('is true only for a team the claim actually lists', () => {
    expect(membershipHasTeam(withTeams, 'team-alpha')).toBe(true);
    expect(membershipHasTeam(withTeams, 'team-gamma')).toBe(false);
  });

  it('is false when the claim carries no teams at all', () => {
    // The shape of a token minted before teams shipped: an absent claim must never
    // read as "any team", or an old token would pass every team gate.
    expect(membershipHasTeam(membership, 'team-alpha')).toBe(false);
    expect(membershipHasTeam({ ...membership, teams: [] }, 'team-alpha')).toBe(false);
  });

  it('is false without a membership or without a team id', () => {
    expect(membershipHasTeam(null, 'team-alpha')).toBe(false);
    expect(membershipHasTeam(undefined, 'team-alpha')).toBe(false);
    expect(membershipHasTeam(withTeams, '')).toBe(false);
  });
});

describe('membershipHas (Clerk-style role AND/OR permission)', () => {
  const withTeams: OrganizationMembership = {
    ...membership,
    teams: ['team-alpha', 'team-beta'],
  };

  it('matches a held team', () => {
    expect(membershipHas(withTeams, { teamId: 'team-alpha' })).toBe(true);
    expect(membershipHas(withTeams, { teamId: 'team-gamma' })).toBe(false);
  });

  it('ANDs teamId with role and permission', () => {
    expect(membershipHas(withTeams, {
      role: 'billing_manager',
      permission: 'org:billing:read',
      teamId: 'team-alpha',
    })).toBe(true);
    // Every criterion must hold: right role and permission, wrong team.
    expect(membershipHas(withTeams, {
      role: 'billing_manager',
      permission: 'org:billing:read',
      teamId: 'team-gamma',
    })).toBe(false);
    // Right team, wrong role.
    expect(membershipHas(withTeams, { role: 'admin', teamId: 'team-alpha' })).toBe(false);
  });

  it('fails a team gate on a claim that predates teams', () => {
    expect(membershipHas(membership, { teamId: 'team-alpha' })).toBe(false);
    // ...while the role gate on that same claim still works.
    expect(membershipHas(membership, { role: 'billing_manager' })).toBe(true);
  });

  it('matches the membership role', () => {
    expect(membershipHas(membership, { role: 'billing_manager' })).toBe(true);
    expect(membershipHas(membership, { role: 'admin' })).toBe(false);
  });

  it('matches a granted permission', () => {
    expect(membershipHas(membership, { permission: 'org:billing:write' })).toBe(true);
    expect(membershipHas(membership, { permission: 'org:billing:delete' })).toBe(false);
  });

  it('requires BOTH when role and permission are given', () => {
    expect(membershipHas(membership, { role: 'billing_manager', permission: 'org:billing:read' })).toBe(true);
    // Right permission, wrong role -> false.
    expect(membershipHas(membership, { role: 'admin', permission: 'org:billing:read' })).toBe(false);
    // Right role, ungranted permission -> false.
    expect(membershipHas(membership, { role: 'billing_manager', permission: 'org:billing:delete' })).toBe(false);
  });

  it('is false with no membership or with no criteria', () => {
    expect(membershipHas(null, { permission: 'org:billing:read' })).toBe(false);
    expect(membershipHas(membership, {})).toBe(false);
  });
});

describe('createMembershipHas', () => {
  it('binds has/hasPermission to a fixed membership', () => {
    const bound = createMembershipHas(membership);
    expect(bound.has({ permission: 'org:billing:read' })).toBe(true);
    expect(bound.hasPermission({ permission: 'org:sys_roles:read' })).toBe(true);
    expect(bound.hasPermission({ permission: 'org:billing:delete' })).toBe(false);
    expect(createMembershipHas(null).has({ role: 'billing_manager' })).toBe(false);
  });
});

/**
 * `member.role` is a comma-separated SET server-side, so `admin,editor` is an
 * ordinary membership. Gating on the primary alone answered false for a role the
 * member genuinely held, while `permissions` had unioned across both - the two
 * halves of one membership disagreeing.
 */
describe('a member holding more than one role', () => {
  const multi = {
    role: 'admin',
    roles: ['admin', 'editor'],
    permissions: ['org:sys_memberships:create'],
    teams: [],
  };

  it('matches on a secondary role, not only the primary', () => {
    expect(membershipHas(multi, { role: 'editor' })).toBe(true);
    expect(membershipHas(multi, { role: 'admin' })).toBe(true);
    expect(membershipHas(multi, { role: 'viewer' })).toBe(false);
  });

  it('still ANDs the other criteria', () => {
    expect(membershipHas(multi, { role: 'editor', permission: 'org:sys_memberships:create' }))
      .toBe(true);
    expect(membershipHas(multi, { role: 'editor', permission: 'org:billing:write' })).toBe(false);
  });

  it('falls back to the primary when an older server sent no set', () => {
    const legacy = { role: 'admin', permissions: [], teams: [] };
    expect(membershipHas(legacy, { role: 'admin' })).toBe(true);
    // Not a claim that they hold nothing - just all the server told us.
    expect(membershipHas(legacy, { role: 'editor' })).toBe(false);
  });
});
