import type { OrganizationMember } from '@authowl/core';

export type OrganizationProfileSection = 'general' | 'members' | 'invitations' | 'danger';

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
