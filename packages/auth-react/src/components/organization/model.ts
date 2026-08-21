import type { OrganizationMember, OrganizationRoleSummary } from '@authowl/core';

export type OrganizationProfileSection = 'general' | 'members' | 'teams' | 'invitations' | 'danger';

export function organizationSlugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function organizationRoles(role: string): string[] {
  return role.split(',').map((value) => value.trim()).filter(Boolean);
}

export function hasOrganizationRole(member: OrganizationMember | undefined, role: string): boolean {
  return member ? organizationRoles(member.role).includes(role) : false;
}

export function canManageOrganization(member: OrganizationMember | undefined): boolean {
  return hasOrganizationRole(member, 'owner') || hasOrganizationRole(member, 'admin');
}

export type TeamManagementCapabilities = {
  createTeam: boolean;
  updateTeam: boolean;
  deleteTeam: boolean;
  addTeamMember: boolean;
  removeTeamMember: boolean;
};

function roleHasStatement(
  roles: OrganizationRoleSummary[],
  heldRoles: Set<string>,
  resource: string,
  action: string,
): boolean {
  return roles.some((role) => {
    if (!heldRoles.has(role.role) || typeof role.permission !== 'object' || role.permission === null) {
      return false;
    }
    const actions = (role.permission as Record<string, unknown>)[resource];
    return Array.isArray(actions) && actions.includes(action);
  });
}

/** Advisory UI capabilities mirroring the engine statements enforced by each team route. */
export function teamManagementCapabilities(
  member: OrganizationMember,
  dynamicRoles: OrganizationRoleSummary[],
): TeamManagementCapabilities {
  const heldRoles = new Set(organizationRoles(member.role));
  if (heldRoles.has('owner') || heldRoles.has('admin')) {
    return {
      createTeam: true,
      updateTeam: true,
      deleteTeam: true,
      addTeamMember: true,
      removeTeamMember: true,
    };
  }
  return {
    createTeam: roleHasStatement(dynamicRoles, heldRoles, 'team', 'create'),
    updateTeam: roleHasStatement(dynamicRoles, heldRoles, 'team', 'update'),
    deleteTeam: roleHasStatement(dynamicRoles, heldRoles, 'team', 'delete'),
    addTeamMember: roleHasStatement(dynamicRoles, heldRoles, 'member', 'update'),
    removeTeamMember: roleHasStatement(dynamicRoles, heldRoles, 'member', 'delete'),
  };
}
