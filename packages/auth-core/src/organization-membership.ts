/**
 * Pure, dependency-free evaluators for an organization membership's advisory
 * permission claim. Shared by the CLIENT `has()` (organization-client.ts, over
 * the browser session) and the SERVER `has()` (server.ts, over a verified JWT),
 * so the two paths can never disagree on what a membership grants.
 *
 * The membership carries the SAME `permissions` array AuthOwl emits into the
 * session and the JWT claim (plan §4/§5): the relabelled `org:sys_*` system ids
 * (plus their legacy bare forms during the dual-emit window) AND the operator's
 * custom `org:<feature>:<action>` ids. Evaluation is a pure array/string check
 * over that local claim - it NEVER calls a statement-only `/organization/has-
 * permission` route, which only knows the 14 static statements and would wrongly
 * report `false` for any custom permission.
 */

/** The active-membership shape carried on the session / decoded from a token. */
export interface OrganizationMembership {
  /**
   * The member's PRIMARY role key (built-in `owner`/`admin`/`member` or a
   * project role). One value, for display - use {@link membershipHas} to gate,
   * because a member can hold more than one.
   */
  role: string;
  /**
   * EVERY role the member holds, sorted. `member.role` is a comma-separated set
   * server-side, so `admin,editor` is an ordinary membership - and gating on
   * `role` alone made the others invisible.
   *
   * Optional because a token or session minted by an older AuthOwl carries only
   * `role`; readers fall back to it rather than reporting a member holds nothing.
   */
  roles?: string[];
  /**
   * The member's effective permission ids: `org:sys_*` system claims (with
   * their legacy bare forms during dual-emit) plus custom `org:<feature>:<action>`
   * ids. Advisory only - the real boundary is server-side over the verified token.
   */
  permissions: string[];
  /**
   * Team ids the member holds inside the ACTIVE organization, as emitted by
   * AuthOwl into both the session and the JWT claim. Teams are pure grouping:
   * belonging to one grants nothing on its own, so this is for the application's
   * own gating, never an authority check.
   *
   * Optional because a token minted before teams shipped carries no `teams` claim.
   * `has({ teamId })` then returns false rather than guessing - it can only ever
   * confirm a team the claim actually proves.
   */
  teams?: string[];
}

/** Clerk-style `has()` query: match the role, the permission, the team, or a combination (AND). */
export interface HasParams {
  role?: string;
  permission?: string;
  /** Require membership of this team within the active organization. */
  teamId?: string;
}

/** True when the membership's permission claim includes `permission`. Pure. */
export function membershipHasPermission(
  membership: OrganizationMembership | null | undefined,
  permission: string,
): boolean {
  if (!membership || !permission) return false;
  return membership.permissions.includes(permission);
}

/**
 * True when the membership's team claim includes `teamId`. Pure.
 *
 * False when the claim carries no `teams` at all, which is what a token minted
 * before teams shipped looks like - an absent claim is never read as "any team".
 */
export function membershipHasTeam(
  membership: OrganizationMembership | null | undefined,
  teamId: string,
): boolean {
  if (!membership || !teamId) return false;
  return membership.teams?.includes(teamId) ?? false;
}

/**
 * Clerk-style `has()`: true when the membership satisfies EVERY provided
 * criterion - the role matches AND the permission is included AND the team is
 * held. Returns false when there is no membership, or when no criterion at all is
 * given. Pure: no I/O, evaluated entirely against the local claim.
 */
/**
 * True when the member holds `role` - as one of their roles, not merely as the
 * primary one. Falls back to the primary when `roles` is absent, which is what a
 * session or token from an older server carries.
 */
export function membershipHasRole(
  membership: OrganizationMembership | null | undefined,
  role: string,
): boolean {
  if (!membership) return false;
  return membership.roles === undefined
    ? membership.role === role
    : membership.roles.includes(role);
}

export function membershipHas(
  membership: OrganizationMembership | null | undefined,
  params: HasParams,
): boolean {
  if (!membership) return false;
  const { role, permission, teamId } = params;
  if (role === undefined && permission === undefined && teamId === undefined) return false;
  if (role !== undefined && !membershipHasRole(membership, role)) return false;
  if (permission !== undefined && !membership.permissions.includes(permission)) return false;
  if (teamId !== undefined && !membershipHasTeam(membership, teamId)) return false;
  return true;
}

/** Bind the pure evaluators to one membership (drives the client / hook `has`). */
export function createMembershipHas(membership: OrganizationMembership | null | undefined): {
  has: (params: HasParams) => boolean;
  hasPermission: (params: { permission: string }) => boolean;
} {
  return {
    has: (params) => membershipHas(membership, params),
    hasPermission: (params) => membershipHasPermission(membership, params.permission),
  };
}
