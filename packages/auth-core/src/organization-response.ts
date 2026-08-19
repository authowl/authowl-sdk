import type {
  AcceptOrganizationInvitationData,
  Organization,
  OrganizationDetails,
  OrganizationInvitation,
  OrganizationInvitationDetails,
  OrganizationInvitationStatus,
  OrganizationMember,
  OrganizationMembersData,
  OrganizationMemberUser,
  OrganizationMemberWithUser,
  OrganizationRoleSummary,
  OrganizationTeam,
  OrganizationUserInvitation,
  RejectOrganizationInvitationData,
  RemoveOrganizationMemberData,
} from './organization-client';
import {
  asDate,
  asRecord,
  asString as asWireString,
  decodeJsonValue,
  invalidResponse,
  optionalNullableString,
} from './response-schema';

const INVITATION_STATUSES = new Set<OrganizationInvitationStatus>([
  'pending',
  'accepted',
  'rejected',
  'canceled',
]);
const MAX_PUBLIC_STRING_LENGTH = 10_000;

export function decodeOrganization(
  value: unknown,
  expectedId?: string,
  expectedSlug?: string,
): Organization {
  const row = asRecord(value);
  const organization = {
    id: asString(row.id),
    name: asString(row.name),
    slug: asString(row.slug),
    createdAt: asDate(row.createdAt),
    ...optionalField('logo', optionalNullableString(row, 'logo')),
    ...optionalField(
      'metadata',
      row.metadata === undefined ? undefined : decodeJsonValue(row.metadata),
    ),
  };
  assertExpected(organization.id, expectedId);
  assertExpected(organization.slug, expectedSlug);
  return organization;
}

export function decodeOrganizations(value: unknown): Organization[] {
  return decodeArray(value, decodeOrganization);
}

export function decodeOrganizationOrNull(
  value: unknown,
  expectedId?: string | null,
  expectedSlug?: string,
): Organization | null {
  if (value === null) return null;
  if (expectedId === null) invalidResponse();
  return decodeOrganization(value, expectedId, expectedSlug);
}

export function decodeOrganizationDetailsOrNull(
  value: unknown,
  expectedId?: string,
  expectedSlug?: string,
): OrganizationDetails | null {
  if (value === null) return null;
  const row = asRecord(value);
  const organization = decodeOrganization(row, expectedId, expectedSlug);
  return {
    ...organization,
    members: decodeArray(row.members, (member) =>
      decodeMemberWithUser(member, organization.id)),
    invitations: decodeArray(row.invitations, (invitation) =>
      decodeInvitation(invitation, undefined, organization.id)),
  };
}

export function decodeOrganizationTeams(
  value: unknown,
  expectedOrganizationId?: string,
): OrganizationTeam[] {
  const teams = decodeArray(value, (team) => decodeOrganizationTeam(team));
  assertSingleOrganization(
    teams.map((team) => team.organizationId),
    expectedOrganizationId,
  );
  return teams;
}

export function decodeOrganizationTeamOrNull(
  value: unknown,
  expectedTeamId?: string | null,
  expectedOrganizationId?: string,
): OrganizationTeam | null {
  if (value === null) return null;
  if (expectedTeamId === null) invalidResponse();
  return decodeOrganizationTeam(value, expectedTeamId, expectedOrganizationId);
}

export function decodeOrganizationMembersData(
  value: unknown,
  expectedOrganizationId?: string,
): OrganizationMembersData {
  const row = asRecord(value);
  if (!Number.isSafeInteger(row.total) || (row.total as number) < 0) invalidResponse();
  return {
    members: decodeOrganizationMembers(row.members, expectedOrganizationId),
    total: row.total as number,
  };
}

export function decodeInvitation(
  value: unknown,
  expectedId?: string,
  expectedOrganizationId?: string,
): OrganizationInvitation {
  const row = asRecord(value);
  const status = asString(row.status) as OrganizationInvitationStatus;
  if (!INVITATION_STATUSES.has(status)) invalidResponse();
  const invitation = {
    id: asString(row.id),
    organizationId: asString(row.organizationId),
    email: asDisplayString(row.email),
    role: asString(row.role),
    status,
    inviterId: asString(row.inviterId),
    expiresAt: asDate(row.expiresAt),
    createdAt: asDate(row.createdAt),
  };
  assertExpected(invitation.id, expectedId);
  assertExpected(invitation.organizationId, expectedOrganizationId);
  return invitation;
}

export function decodeInvitations(
  value: unknown,
  expectedOrganizationId?: string,
): OrganizationInvitation[] {
  const invitations = decodeArray(value, (invitation) =>
    decodeInvitation(invitation));
  assertSingleOrganization(
    invitations.map((invitation) => invitation.organizationId),
    expectedOrganizationId,
  );
  return invitations;
}

export function decodeUserInvitations(value: unknown): OrganizationUserInvitation[] {
  return decodeArray(value, (entry) => {
    const row = asRecord(entry);
    return {
      ...decodeInvitation(row),
      organizationName: asDisplayString(row.organizationName),
    };
  });
}

export function decodeInvitationDetails(
  value: unknown,
  expectedId?: string,
): OrganizationInvitationDetails {
  const row = asRecord(value);
  return {
    ...decodeInvitation(row, expectedId),
    organizationName: asString(row.organizationName),
    organizationSlug: asString(row.organizationSlug),
    inviterEmail: asEmail(row.inviterEmail),
  };
}

export function decodeAcceptInvitation(
  value: unknown,
  expectedInvitationId?: string,
): AcceptOrganizationInvitationData {
  const row = asRecord(value);
  const invitation = decodeInvitation(row.invitation, expectedInvitationId);
  return {
    invitation,
    member: decodeMember(row.member, undefined, invitation.organizationId),
  };
}

export function decodeRejectInvitation(
  value: unknown,
  expectedInvitationId?: string,
): RejectOrganizationInvitationData {
  const row = asRecord(value);
  if (row.member !== null) invalidResponse();
  return {
    invitation: row.invitation === null
      ? null
      : decodeInvitation(row.invitation, expectedInvitationId),
    member: null,
  };
}

export function decodeInvitationOrNull(
  value: unknown,
  expectedInvitationId?: string,
): OrganizationInvitation | null {
  return value === null ? null : decodeInvitation(value, expectedInvitationId);
}

export function decodeRemoveMember(
  value: unknown,
  expectedOrganizationId?: string,
  expectedMemberId?: string,
): RemoveOrganizationMemberData {
  const row = asRecord(value);
  return {
    member: decodeMember(row.member, expectedMemberId, expectedOrganizationId),
  };
}

export function decodeMember(
  value: unknown,
  expectedId?: string,
  expectedOrganizationId?: string,
): OrganizationMember {
  const row = asRecord(value);
  const member = {
    id: asString(row.id),
    organizationId: asString(row.organizationId),
    userId: asString(row.userId),
    role: asString(row.role),
    createdAt: asDate(row.createdAt),
    ...(row.user === undefined ? {} : { user: decodeMemberUser(row.user) }),
  };
  assertExpected(member.id, expectedId);
  assertExpected(member.organizationId, expectedOrganizationId);
  return member;
}

export function decodeOrganizationRoles(
  value: unknown,
  expectedOrganizationId?: string,
): OrganizationRoleSummary[] {
  const roles = decodeArray(value, (entry) => {
    const row = asRecord(entry);
    return {
      organizationId: asString(row.organizationId),
      data: {
        role: asString(row.role),
        ...optionalField(
          'permission',
          row.permission === undefined ? undefined : decodePermission(row.permission),
        ),
      },
    };
  });
  assertSingleOrganization(
    roles.map((role) => role.organizationId),
    expectedOrganizationId,
  );
  return roles.map((role) => role.data);
}

function decodeOrganizationTeam(
  value: unknown,
  expectedId?: string,
  expectedOrganizationId?: string,
): OrganizationTeam {
  const row = asRecord(value);
  const updatedAt = row.updatedAt;
  const team = {
    id: asString(row.id),
    name: asDisplayString(row.name),
    organizationId: asString(row.organizationId),
    createdAt: asDate(row.createdAt),
    ...(updatedAt === undefined ? {} : { updatedAt: asDate(updatedAt) }),
  };
  assertExpected(team.id, expectedId);
  assertExpected(team.organizationId, expectedOrganizationId);
  return team;
}

function decodeMemberWithUser(
  value: unknown,
  expectedOrganizationId?: string,
): OrganizationMemberWithUser {
  const row = asRecord(value);
  return {
    ...decodeMember(row, undefined, expectedOrganizationId),
    user: decodeMemberUser(row.user),
  };
}

function decodeOrganizationMembers(
  value: unknown,
  expectedOrganizationId?: string,
): OrganizationMemberWithUser[] {
  const members = decodeArray(value, (member) => decodeMemberWithUser(member));
  assertSingleOrganization(
    members.map((member) => member.organizationId),
    expectedOrganizationId,
  );
  return members;
}

function decodePermission(value: unknown): Record<string, string[]> {
  const row = asRecord(value);
  const permission: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(row)) {
    if (
      resource === '__proto__'
      || resource === 'constructor'
      || resource === 'prototype'
      || resource.length === 0
      || resource.length > MAX_PUBLIC_STRING_LENGTH
      || !Array.isArray(actions)
    ) {
      invalidResponse();
    }
    permission[resource] = actions.map((action) => asString(action));
  }
  return permission;
}

/**
 * Identifiers and other load-bearing strings: non-empty, length-capped. Used for
 * ids, slugs, roles, and statuses - anything an empty value would silently
 * corrupt rather than merely render blank.
 */
function asString(value: unknown): string {
  const decoded = asWireString(value);
  if (decoded.length === 0 || decoded.length > MAX_PUBLIC_STRING_LENGTH) {
    invalidResponse();
  }
  return decoded;
}

/**
 * Display strings, which are allowed to be empty. A user's `name` is nullable in
 * the store AND this SDK's own sign-up form posts `name: ''` under the default
 * capability config, so `''` and `null` are both real wire values that mean the
 * same thing: no display name. Rejecting them made a single nameless member
 * undecodable for the WHOLE organization - including the receipt of `leave()`
 * and `removeMember()`, mutations the server had already performed.
 *
 * The `MAX_PUBLIC_STRING_LENGTH` cap stays: that is response hardening, not a
 * presence check.
 */
function asDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  const decoded = asWireString(value);
  if (decoded.length > MAX_PUBLIC_STRING_LENGTH) invalidResponse();
  return decoded;
}

/**
 * Addresses that the server may REDACT. `null` is meaningful here in a way it is
 * not for a display name: it says "this address was withheld", which is exactly
 * what a phone-only user's synthetic address must become. So `null` is preserved
 * rather than coerced, and a present address still has to be a non-empty capped
 * string - an empty address is malformed, not redacted.
 */
function asEmail(value: unknown): string | null {
  return value === null ? null : asString(value);
}

function assertExpected(actual: string, expected?: string): void {
  if (expected !== undefined && actual !== expected) invalidResponse();
}

function assertSingleOrganization(
  organizationIds: string[],
  expected?: string,
): void {
  const organizationId = expected ?? organizationIds[0];
  if (
    organizationId !== undefined
    && organizationIds.some((candidate) => candidate !== organizationId)
  ) {
    invalidResponse();
  }
}

function decodeMemberUser(value: unknown): OrganizationMemberUser {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asDisplayString(row.name),
    email: asEmail(row.email),
    ...optionalField('image', optionalNullableString(row, 'image')),
  };
}

function decodeArray<T>(
  value: unknown,
  decode: (entry: unknown) => T,
): T[] {
  if (!Array.isArray(value)) invalidResponse();
  return value.map((entry) => decode(entry));
}

function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [K in Key]?: Value } {
  return value === undefined ? {} : { [key]: value } as { [K in Key]?: Value };
}
