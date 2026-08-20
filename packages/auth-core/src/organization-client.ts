import type { ActionFetchOptions, AuthActionResult } from './client';
import type { AuthHttpClient } from './http-client';
import { createAuthActionHelpers } from './http-client';
import {
  membershipHas,
  membershipHasPermission,
  type HasParams,
  type OrganizationMembership,
} from './organization-membership';
import {
  decodeAcceptInvitation,
  decodeInvitation,
  decodeInvitationDetails,
  decodeInvitationOrNull,
  decodeInvitations,
  decodeMember,
  decodeOrganization,
  decodeOrganizationDetailsOrNull,
  decodeOrganizationMembersData,
  decodeOrganizationOrNull,
  decodeOrganizationRoles,
  decodeOrganizations,
  decodeOrganizationTeamOrNull,
  decodeOrganizationTeams,
  decodeRejectInvitation,
  decodeRemoveMember,
  decodeUserInvitations,
} from './organization-response';

export type { HasParams, OrganizationMembership } from './organization-membership';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  logo?: string | null;
  metadata?: unknown;
}

export interface OrganizationMemberUser {
  id: string;
  /**
   * Display name. Empty when the member never supplied one - the store column is
   * nullable and the sign-up form posts `''` by default - so render it with a
   * fallback rather than assuming it is populated.
   */
  name: string;
  /** `null` when the server withholds the address (for example a phone-only member). */
  email: string | null;
  image?: string | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
  user?: OrganizationMemberUser;
}

export interface OrganizationMemberWithUser extends OrganizationMember {
  user: OrganizationMemberUser;
}

export type OrganizationInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'canceled';

export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: OrganizationInvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface OrganizationInvitationDetails extends OrganizationInvitation {
  organizationName: string;
  organizationSlug: string;
  /** `null` when the server withholds the inviter's address. */
  inviterEmail: string | null;
}

export interface OrganizationUserInvitation extends OrganizationInvitation {
  organizationName: string;
}

export interface OrganizationDetails extends Organization {
  members: OrganizationMemberWithUser[];
  invitations: OrganizationInvitation[];
}

export interface CreateOrganizationOptions {
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: Record<string, unknown>;
  keepCurrentActiveOrganization?: boolean;
}

export interface OrganizationSelector {
  organizationId?: string;
  organizationSlug?: string;
}

export interface GetOrganizationOptions extends OrganizationSelector {
  membersLimit?: number;
}

export interface SetActiveOrganizationOptions {
  organizationId?: string | null;
  organizationSlug?: string;
}

/**
 * A team: a named sub-group of members inside one organization.
 *
 * Teams are GROUPING only. Being on one grants nothing - a member's authority comes
 * from their organization role. Use a team to decide what your own product shows or
 * routes, never as an authority check.
 */
export interface OrganizationTeam {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface ListOrganizationTeamsOptions {
  /** Defaults to the caller's active organization. */
  organizationId?: string;
}

export interface SetActiveTeamOptions {
  /** The team to make active, or null to clear it. Must be a team the caller is on. */
  teamId: string | null;
}

export interface UpdateOrganizationOptions {
  organizationId?: string;
  data: {
    name?: string;
    slug?: string;
    logo?: string | null;
    metadata?: Record<string, unknown>;
  };
}

export interface DeleteOrganizationOptions {
  organizationId: string;
}

export type OrganizationFilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts_with'
  | 'ends_with';

export interface ListOrganizationMembersOptions extends OrganizationSelector {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  filterField?: string;
  filterValue?: string | number | boolean;
  filterOperator?: OrganizationFilterOperator;
}

export interface OrganizationMembersData {
  members: OrganizationMemberWithUser[];
  total: number;
}

export interface InviteOrganizationMemberOptions {
  email: string;
  role: string | string[];
  organizationId?: string;
  resend?: boolean;
}

export interface ListOrganizationInvitationsOptions {
  organizationId?: string;
}

export interface GetOrganizationInvitationOptions {
  id: string;
}

export interface OrganizationInvitationActionOptions {
  invitationId: string;
}

export interface AcceptOrganizationInvitationData {
  invitation: OrganizationInvitation;
  member: OrganizationMember;
}

export interface RejectOrganizationInvitationData {
  invitation: OrganizationInvitation | null;
  member: null;
}

export interface RemoveOrganizationMemberOptions {
  memberIdOrEmail: string;
  organizationId?: string;
}

export interface RemoveOrganizationMemberData {
  member: OrganizationMember;
}

export interface UpdateOrganizationMemberRoleOptions {
  memberId: string;
  role: string | string[];
  organizationId?: string;
}

export interface LeaveOrganizationOptions {
  organizationId: string;
}

export interface ListOrganizationRolesOptions {
  /** Defaults to the caller's active organization. */
  organizationId?: string;
}

/**
 * A role assignable in an organization, as returned by the engine's
 * `/organization/list-roles` (the per-org dynamic roles, which after projection
 * include this project's custom roles). Built-in `owner`/`admin`/`member` are
 * static and NOT returned here - the UI adds them alongside this list.
 */
export interface OrganizationRoleSummary {
  role: string;
  /** The role's ⊆14 system-statement document (engine shape); advisory here. */
  permission?: unknown;
}

export interface OrganizationClient {
  create(
    params: CreateOrganizationOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<Organization>>;
  list(fetchOptions?: ActionFetchOptions): Promise<AuthActionResult<Organization[]>>;
  get(
    params?: GetOrganizationOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationDetails | null>>;
  setActive(
    params: SetActiveOrganizationOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<Organization | null>>;
  /**
   * The teams of an organization, for resolving the team ids carried in the
   * membership claim to names. Requires membership of that organization.
   */
  listTeams(
    params?: ListOrganizationTeamsOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationTeam[]>>;
  /**
   * Select the caller's active team, which surfaces as `activeTeamId` on the session
   * and `team_id` in the project token. Only a team the caller is on can be made
   * active; pass null to clear it. Clearing also happens on its own whenever the
   * active organization changes.
   */
  setActiveTeam(
    params: SetActiveTeamOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationTeam | null>>;
  update(
    params: UpdateOrganizationOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<Organization | null>>;
  delete(
    params: DeleteOrganizationOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<Organization>>;
  listMembers(
    params?: ListOrganizationMembersOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationMembersData>>;
  inviteMember(
    params: InviteOrganizationMemberOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationInvitation>>;
  listInvitations(
    params?: ListOrganizationInvitationsOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationInvitation[]>>;
  listUserInvitations(
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationUserInvitation[]>>;
  getInvitation(
    params: GetOrganizationInvitationOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationInvitationDetails>>;
  acceptInvitation(
    params: OrganizationInvitationActionOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<AcceptOrganizationInvitationData>>;
  rejectInvitation(
    params: OrganizationInvitationActionOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<RejectOrganizationInvitationData>>;
  cancelInvitation(
    params: OrganizationInvitationActionOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationInvitation | null>>;
  removeMember(
    params: RemoveOrganizationMemberOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<RemoveOrganizationMemberData>>;
  updateMemberRole(
    params: UpdateOrganizationMemberRoleOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationMember>>;
  leave(
    params: LeaveOrganizationOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationMember>>;
  /**
   * List the roles assignable in an organization (the engine's dynamic roles,
   * which include this project's projected custom roles). Built-in roles are
   * static and not returned; surfaces populate the select alongside them.
   */
  listRoles(
    params?: ListOrganizationRolesOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<OrganizationRoleSummary[]>>;
  /**
   * Clerk-style `has()` over the ACTIVE membership's advisory claim: true when
   * the signed-in member's role matches `role` AND/OR their permissions include
   * `permission`. PURE + synchronous - it reads the local session claim and
   * NEVER calls `/organization/has-permission` (which only knows the 14 static
   * statements and would wrongly deny custom permissions). UX affordance only;
   * enforce real authorization server-side over the verified token.
   */
  has(params: HasParams): boolean;
  /** Clerk-style `hasPermission()`: true when the active membership grants `permission`. Pure. */
  hasPermission(params: { permission: string }): boolean;
}

export function createOrganizationClient(
  http: AuthHttpClient,
  notifyMutation: () => void,
  /**
   * Reads the CURRENT active membership from the live session snapshot so the
   * pure `has()`/`hasPermission()` evaluate against the freshest claim. Defaults
   * to "no membership" (always false) for headless/pre-session construction.
   */
  getMembership: () => OrganizationMembership | null = () => null,
): OrganizationClient {
  const { post, mutation: sendMutation } = createAuthActionHelpers(http, notifyMutation);
  /**
   * Reads of the same thing that are open AT THE SAME TIME, joined.
   *
   * `useOrganization()` fetches per consumer, so a page that renders the switcher,
   * a members table and three `<Protect>` boundaries asked the server for the
   * same organization once per component - a dozen identical requests for one
   * load, every load.
   *
   * This is a JOIN, not a cache. Nothing is retained after a request settles, so
   * the next read is a real read and this cannot serve anything staler than a
   * request that is still open - the same reasoning the session store's idle
   * refresh already uses.
   */
  const inFlightReads = new Map<string, Promise<AuthActionResult<unknown>>>();
  const get = <T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    fetchOptions?: ActionFetchOptions,
    decode?: (value: unknown) => T,
  ): Promise<AuthActionResult<T>> => {
    // A caller supplying its own fetch options gets its own request: those carry
    // an abort signal or headers that belong to one caller, and handing it a
    // promise another caller can abort would be a bug wearing a speed-up.
    if (fetchOptions) return http.request<T>(path, { query, fetchOptions, decode });
    const key = `${path}\u0000${JSON.stringify(query ?? null)}`;
    const joined = inFlightReads.get(key);
    if (joined) return joined as Promise<AuthActionResult<T>>;
    const request = http.request<T>(path, { query, decode }).finally(() => {
      inFlightReads.delete(key);
    });
    inFlightReads.set(key, request as Promise<AuthActionResult<unknown>>);
    return request;
  };
  /**
   * A write ends every join in progress. A read that STARTED before the write
   * committed would answer with the state the write just replaced, and a caller
   * refreshing straight after its own mutation must not be handed that.
   */
  const mutation = <T>(action: Promise<AuthActionResult<T>>): Promise<AuthActionResult<T>> =>
    sendMutation(action).finally(() => inFlightReads.clear());
  return {
    create: (params, fetchOptions) =>
      mutation(post('/organization/create', params, fetchOptions, decodeOrganization)),
    list: (fetchOptions) =>
      get('/organization/list', undefined, fetchOptions, decodeOrganizations),
    get: (params = {}, fetchOptions) =>
      get(
        '/organization/get-full-organization',
        {
          organizationId: params.organizationId,
          organizationSlug: params.organizationSlug,
          membersLimit: params.membersLimit,
        },
        fetchOptions,
        (value) =>
          decodeOrganizationDetailsOrNull(
            value,
            params.organizationId,
            params.organizationSlug,
          ),
      ),
    setActive: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/set-active',
          params,
          fetchOptions,
          (value) =>
            decodeOrganizationOrNull(
              value,
              params.organizationId,
              params.organizationSlug,
            ),
        ),
      ),
    listTeams: (params = {}, fetchOptions) =>
      get(
        '/organization/list-teams',
        { organizationId: params.organizationId },
        fetchOptions,
        (value) => decodeOrganizationTeams(value, params.organizationId),
      ),
    setActiveTeam: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/set-active-team',
          params,
          fetchOptions,
          (value) =>
            decodeOrganizationTeamOrNull(
              value,
              params.teamId,
            ),
        ),
      ),
    update: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/update',
          params,
          fetchOptions,
          (value) => decodeOrganizationOrNull(value, params.organizationId),
        ),
      ),
    delete: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/delete',
          params,
          fetchOptions,
          (value) => decodeOrganization(value, params.organizationId),
        ),
      ),
    listMembers: (params = {}, fetchOptions) =>
      get(
        '/organization/list-members',
        {
          organizationId: params.organizationId,
          organizationSlug: params.organizationSlug,
          limit: params.limit,
          offset: params.offset,
          sortBy: params.sortBy,
          sortDirection: params.sortDirection,
          filterField: params.filterField,
          filterValue: params.filterValue,
          filterOperator: params.filterOperator,
        },
        fetchOptions,
        (value) => decodeOrganizationMembersData(value, params.organizationId),
      ),
    inviteMember: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/invite-member',
          params,
          fetchOptions,
          (value) => decodeInvitation(value, undefined, params.organizationId),
        ),
      ),
    listInvitations: (params = {}, fetchOptions) =>
      get(
        '/organization/list-invitations',
        { organizationId: params.organizationId },
        fetchOptions,
        (value) => decodeInvitations(value, params.organizationId),
      ),
    listUserInvitations: (fetchOptions) =>
      get(
        '/organization/list-user-invitations',
        undefined,
        fetchOptions,
        decodeUserInvitations,
      ),
    getInvitation: (params, fetchOptions) =>
      get(
        '/organization/get-invitation',
        { id: params.id },
        fetchOptions,
        (value) => decodeInvitationDetails(value, params.id),
      ),
    acceptInvitation: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/accept-invitation',
          params,
          fetchOptions,
          (value) => decodeAcceptInvitation(value, params.invitationId),
        ),
      ),
    rejectInvitation: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/reject-invitation',
          params,
          fetchOptions,
          (value) => decodeRejectInvitation(value, params.invitationId),
        ),
      ),
    cancelInvitation: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/cancel-invitation',
          params,
          fetchOptions,
          (value) => decodeInvitationOrNull(value, params.invitationId),
        ),
      ),
    removeMember: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/remove-member',
          params,
          fetchOptions,
          (value) =>
            decodeRemoveMember(
              value,
              params.organizationId,
              params.memberIdOrEmail.includes('@')
                ? undefined
                : params.memberIdOrEmail,
            ),
        ),
      ),
    updateMemberRole: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/update-member-role',
          params,
          fetchOptions,
          (value) => decodeMember(value, params.memberId, params.organizationId),
        ),
      ),
    leave: (params, fetchOptions) =>
      mutation(
        post(
          '/organization/leave',
          params,
          fetchOptions,
          (value) => decodeMember(value, undefined, params.organizationId),
        ),
      ),
    listRoles: (params = {}, fetchOptions) =>
      get(
        '/organization/list-roles',
        {
          organizationId: params.organizationId,
        },
        fetchOptions,
        (value) => decodeOrganizationRoles(value, params.organizationId),
      ),
    // Pure + synchronous: evaluate the LOCAL membership claim. Never an HTTP
    // call - crucially not `/organization/has-permission`, which is blind to
    // custom permissions (plan §3/§5 advisory-boundary invariant).
    has: (params) => membershipHas(getMembership(), params),
    hasPermission: (params) => membershipHasPermission(getMembership(), params.permission),
  };
}
