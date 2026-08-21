import { describe, expect, it, vi } from 'vitest';
import { createAuthOwlClient, type ActionFetchOptions } from './client';
import { resolveConfig } from './config';
import type {
  OrganizationDetails,
  OrganizationInvitation,
  OrganizationTeam,
  OrganizationUserInvitation,
} from './organization-client';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const AUTH_PATH = `/api/projects/${PROJECT_ID}/auth`;
const CREATED_AT = '2026-07-14T08:00:00.000Z';

const organizationWire = () => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  createdAt: CREATED_AT,
});

const memberWire = (withUser = false) => ({
  id: 'member-1',
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'member',
  createdAt: CREATED_AT,
  ...(withUser
    ? {
        user: {
          id: 'user-1',
          name: 'Member',
          email: 'member@example.test',
        },
      }
    : {}),
});

const invitationWire = (id = 'invitation-1') => ({
  id,
  organizationId: 'org-1',
  email: 'member@example.test',
  role: 'member',
  status: 'pending',
  inviterId: 'user-owner',
  expiresAt: '2026-07-30T08:00:00.000Z',
  createdAt: CREATED_AT,
});

const teamWire = () => ({
  id: 'team-1',
  name: 'Core',
  organizationId: 'org-1',
  createdAt: CREATED_AT,
});

const teamMemberWire = (userId = 'user-1') => ({
  id: `team-member-${userId}`,
  teamId: 'team-1',
  userId,
  createdAt: CREATED_AT,
});

function clientWith(fetchImpl: typeof fetch) {
  return createAuthOwlClient(
    resolveConfig({
      publishableKey: PK,
      apiUrl: 'https://auth.example.com',
      fetch: fetchImpl,
    }),
  );
}

describe('organization client', () => {
  it('routes the complete organization lifecycle and preserves query selectors', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/organization/list')) return Response.json([organizationWire()]);
      if (path.endsWith('/get-full-organization')) {
        return Response.json({
          ...organizationWire(),
          members: [memberWire(true)],
          invitations: [invitationWire()],
        });
      }
      if (path.endsWith('/list-members')) {
        return Response.json({ members: [memberWire(true)], total: 1 });
      }
      if (path.endsWith('/create-team') || path.endsWith('/update-team')) {
        return Response.json(teamWire());
      }
      if (path.endsWith('/remove-team')) {
        return Response.json({ message: 'Team removed successfully.' });
      }
      if (path.endsWith('/list-teams')) return Response.json([teamWire()]);
      if (path.endsWith('/list-user-teams')) {
        return Response.json([teamWire(), { ...teamWire(), id: 'team-2', organizationId: 'org-2' }]);
      }
      if (path.endsWith('/list-team-members')) return Response.json([teamMemberWire()]);
      if (path.endsWith('/add-team-member')) return Response.json(teamMemberWire());
      if (path.endsWith('/remove-team-member')) {
        return Response.json({ message: 'Team member removed successfully.' });
      }
      if (path.endsWith('/set-active-team')) return Response.json(teamWire());
      if (path.endsWith('/list-invitations')) return Response.json([invitationWire()]);
      if (path.endsWith('/list-user-invitations')) {
        return Response.json([{ ...invitationWire(), organizationName: 'Acme' }]);
      }
      if (path.endsWith('/get-invitation')) {
        return Response.json({
          ...invitationWire(),
          organizationName: 'Acme',
          organizationSlug: 'acme',
          inviterEmail: 'owner@example.test',
        });
      }
      if (path.endsWith('/accept-invitation')) {
        return Response.json({
          invitation: invitationWire(),
          member: memberWire(),
        });
      }
      if (path.endsWith('/reject-invitation')) {
        return Response.json({
          invitation: invitationWire('invitation-2'),
          member: null,
        });
      }
      if (path.endsWith('/cancel-invitation')) {
        return Response.json(invitationWire('invitation-3'));
      }
      if (path.endsWith('/remove-member')) {
        return Response.json({ member: memberWire() });
      }
      if (path.endsWith('/update-member-role') || path.endsWith('/leave')) {
        return Response.json(memberWire());
      }
      if (path.endsWith('/invite-member')) return Response.json(invitationWire());
      return Response.json(organizationWire());
    }) as unknown as typeof fetch;
    const organization = clientWith(fetchImpl).organization;
    const mutationListener = vi.fn();
    const unsubscribe = organization.subscribe(mutationListener);
    const options = { headers: { 'x-test': 'organization' } };

    const results = [];
    results.push(await organization.create({ name: 'Acme', slug: 'acme' }, options));
    results.push(await organization.list());
    results.push(await organization.get({ organizationSlug: 'acme', membersLimit: 25 }, options));
    results.push(await organization.setActive({ organizationId: 'org-1' }, options));
    results.push(await organization.createTeam({ organizationId: 'org-1', name: 'Core' }, options));
    results.push(await organization.listTeams({ organizationId: 'org-1' }, options));
    results.push(await organization.updateTeam({ teamId: 'team-1', data: { name: 'Platform', organizationId: 'org-1' } }, options));
    results.push(await organization.removeTeam({ teamId: 'team-1', organizationId: 'org-1' }, options));
    results.push(await organization.listUserTeams(options));
    results.push(await organization.listTeamMembers({ teamId: 'team-1' }, options));
    results.push(await organization.addTeamMember({ teamId: 'team-1', userId: 'user-1', organizationId: 'org-1' }, options));
    results.push(await organization.removeTeamMember({ teamId: 'team-1', userId: 'user-1', organizationId: 'org-1' }, options));
    results.push(await organization.setActiveTeam({ teamId: 'team-1' }, options));
    results.push(await organization.update(
      { organizationId: 'org-1', data: { name: 'Acme Egypt' } },
      options,
    ));
    results.push(await organization.delete({ organizationId: 'org-1' }, options));
    results.push(await organization.listMembers({
      organizationId: 'org-1',
      limit: 20,
      offset: 5,
      sortDirection: 'asc',
    }, options));
    results.push(await organization.inviteMember({
      organizationId: 'org-1',
      email: 'member@example.test',
      role: 'member',
    }, options));
    results.push(await organization.listInvitations({ organizationId: 'org-1' }, options));
    results.push(await organization.listUserInvitations(options));
    results.push(await organization.getInvitation({ id: 'invitation-1' }, options));
    results.push(await organization.acceptInvitation({ invitationId: 'invitation-1' }, options));
    results.push(await organization.rejectInvitation({ invitationId: 'invitation-2' }, options));
    results.push(await organization.cancelInvitation({ invitationId: 'invitation-3' }, options));
    results.push(await organization.removeMember(
      { memberIdOrEmail: 'member-1', organizationId: 'org-1' },
      options,
    ));
    results.push(await organization.updateMemberRole({
      memberId: 'member-1',
      organizationId: 'org-1',
      role: 'admin',
    }, options));
    results.push(await organization.leave({ organizationId: 'org-1' }, options));

    const resultNames = [
      'create',
      'list',
      'get',
      'setActive',
      'createTeam',
      'listTeams',
      'updateTeam',
      'removeTeam',
      'listUserTeams',
      'listTeamMembers',
      'addTeamMember',
      'removeTeamMember',
      'setActiveTeam',
      'update',
      'delete',
      'listMembers',
      'inviteMember',
      'listInvitations',
      'listUserInvitations',
      'getInvitation',
      'acceptInvitation',
      'rejectInvitation',
      'cancelInvitation',
      'removeMember',
      'updateMemberRole',
      'leave',
    ];
    expect(results.map((result, index) => ({
      name: resultNames[index],
      error: result.error?.code ?? null,
    }))).toEqual(resultNames.map((name) => ({ name, error: null })));
    expect(results[0]?.data).toMatchObject({ createdAt: expect.any(Date) });
    expect(results[resultNames.indexOf('createTeam')]?.data).toEqual({
      ...teamWire(),
      createdAt: new Date(CREATED_AT),
    });
    expect(results[resultNames.indexOf('listUserTeams')]?.data).toEqual([
      { ...teamWire(), createdAt: new Date(CREATED_AT) },
      { ...teamWire(), id: 'team-2', organizationId: 'org-2', createdAt: new Date(CREATED_AT) },
    ]);
    expect(results[resultNames.indexOf('listTeamMembers')]?.data).toEqual([
      { ...teamMemberWire(), createdAt: new Date(CREATED_AT) },
    ]);
    expect(results[resultNames.indexOf('removeTeamMember')]?.data).toEqual({
      message: 'Team member removed successfully.',
    });
    expect(mutationListener).toHaveBeenCalledTimes(17);
    unsubscribe();
    const calls = (
      fetchImpl as unknown as { mock: { calls: [string | URL, RequestInit][] } }
    ).mock.calls;
    expect(calls.map(([url, init]) => `${init.method ?? 'GET'} ${new URL(String(url)).pathname}`))
      .toEqual([
        `POST ${AUTH_PATH}/organization/create`,
        `GET ${AUTH_PATH}/organization/list`,
        `GET ${AUTH_PATH}/organization/get-full-organization`,
        `POST ${AUTH_PATH}/organization/set-active`,
        `POST ${AUTH_PATH}/organization/create-team`,
        `GET ${AUTH_PATH}/organization/list-teams`,
        `POST ${AUTH_PATH}/organization/update-team`,
        `POST ${AUTH_PATH}/organization/remove-team`,
        `GET ${AUTH_PATH}/organization/list-user-teams`,
        `GET ${AUTH_PATH}/organization/list-team-members`,
        `POST ${AUTH_PATH}/organization/add-team-member`,
        `POST ${AUTH_PATH}/organization/remove-team-member`,
        `POST ${AUTH_PATH}/organization/set-active-team`,
        `POST ${AUTH_PATH}/organization/update`,
        `POST ${AUTH_PATH}/organization/delete`,
        `GET ${AUTH_PATH}/organization/list-members`,
        `POST ${AUTH_PATH}/organization/invite-member`,
        `GET ${AUTH_PATH}/organization/list-invitations`,
        `GET ${AUTH_PATH}/organization/list-user-invitations`,
        `GET ${AUTH_PATH}/organization/get-invitation`,
        `POST ${AUTH_PATH}/organization/accept-invitation`,
        `POST ${AUTH_PATH}/organization/reject-invitation`,
        `POST ${AUTH_PATH}/organization/cancel-invitation`,
        `POST ${AUTH_PATH}/organization/remove-member`,
        `POST ${AUTH_PATH}/organization/update-member-role`,
        `POST ${AUTH_PATH}/organization/leave`,
      ]);
    // Looked up by path, not by index: inserting a call above used to silently
    // shift every one of these onto the wrong request.
    const queryFor = (suffix: string) => {
      const call = calls.find(([url]) => new URL(String(url)).pathname.endsWith(suffix));
      if (!call) throw new Error(`no request to ${suffix}`);
      return new URL(String(call[0])).searchParams;
    };
    expect(queryFor('/get-full-organization').get('organizationSlug')).toBe('acme');
    expect(queryFor('/get-full-organization').get('membersLimit')).toBe('25');
    expect(queryFor('/list-members').get('offset')).toBe('5');
    expect(queryFor('/list-invitations').get('organizationId')).toBe('org-1');
    expect(queryFor('/get-invitation').get('id')).toBe('invitation-1');
    expect(queryFor('/list-teams').get('organizationId')).toBe('org-1');
    expect(queryFor('/list-team-members').get('teamId')).toBe('team-1');

    const bodyFor = (suffix: string) => {
      const call = calls.find(([url]) => new URL(String(url)).pathname.endsWith(suffix));
      if (!call) throw new Error(`no request to ${suffix}`);
      return JSON.parse(String(call[1].body)) as unknown;
    };
    expect(bodyFor('/create-team')).toEqual({ organizationId: 'org-1', name: 'Core' });
    expect(bodyFor('/update-team')).toEqual({
      teamId: 'team-1',
      data: { name: 'Platform', organizationId: 'org-1' },
    });
    expect(bodyFor('/remove-team')).toEqual({ teamId: 'team-1', organizationId: 'org-1' });
    expect(bodyFor('/add-team-member')).toEqual({
      teamId: 'team-1', userId: 'user-1', organizationId: 'org-1',
    });
    expect(bodyFor('/remove-team-member')).toEqual({
      teamId: 'team-1', userId: 'user-1', organizationId: 'org-1',
    });
  });

  it('routes listRoles to the engine list-roles endpoint with the org selector', async () => {
    const fetchImpl = vi.fn(async () => Response.json([
      {
        organizationId: 'org-1',
        role: 'billing_manager',
        permission: { member: ['create'] },
      },
    ])) as unknown as typeof fetch;
    const organization = clientWith(fetchImpl).organization;

    const result = await organization.listRoles({ organizationId: 'org-1' });

    expect(result.data).toEqual([
      { role: 'billing_manager', permission: { member: ['create'] } },
    ]);
    const calls = (fetchImpl as unknown as { mock: { calls: [string | URL, RequestInit][] } }).mock.calls;
    expect(`${calls[0]![1].method ?? 'GET'} ${new URL(String(calls[0]![0])).pathname}`)
      .toBe(`GET ${AUTH_PATH}/organization/list-roles`);
    expect(new URL(String(calls[0]![0])).searchParams.get('organizationId')).toBe('org-1');
  });

  it('projects exact public organization DTOs and drops credential-shaped extras', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      ...organizationWire(),
      metadata: { token: 'operator-owned-value', theme: 'warm' },
      token: 'organization-secret',
      projectId: 'project-secret',
      members: [{
        ...memberWire(true),
        token: 'member-secret',
        passwordHash: 'password-hash',
        user: {
          ...memberWire(true).user,
          token: 'user-secret',
          passwordHash: 'user-password-hash',
          privateMetadata: { note: 'private' },
        },
      }],
      invitations: [{
        ...invitationWire(),
        token: 'invitation-secret',
        callbackURL: 'https://evil.example/invite',
      }],
      teams: [{ ...teamWire(), secret: 'team-secret' }],
    })) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).organization.get({
      organizationId: 'org-1',
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(CREATED_AT),
      metadata: { token: 'operator-owned-value', theme: 'warm' },
      members: [{
        id: 'member-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'member',
        createdAt: new Date(CREATED_AT),
        user: {
          id: 'user-1',
          name: 'Member',
          email: 'member@example.test',
        },
      }],
      invitations: [{
        ...invitationWire(),
        expiresAt: new Date(invitationWire().expiresAt),
        createdAt: new Date(CREATED_AT),
      }],
    });
    const serialized = JSON.stringify(result.data);
    expect(serialized).toContain('operator-owned-value');
    expect(serialized).not.toContain('organization-secret');
    expect(serialized).not.toContain('project-secret');
    expect(serialized).not.toContain('member-secret');
    expect(serialized).not.toContain('password-hash');
    expect(serialized).not.toContain('user-secret');
    expect(serialized).not.toContain('user-password-hash');
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('invitation-secret');
    expect(serialized).not.toContain('evil.example');
    expect(serialized).not.toContain('team-secret');
  });

  it('rejects cross-organization nested rows and malformed role permissions', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        ...organizationWire(),
        members: [{ ...memberWire(true), organizationId: 'foreign-org' }],
        invitations: [invitationWire()],
      }))
      .mockResolvedValueOnce(Response.json([
        {
          organizationId: 'org-1',
          role: 'billing_manager',
          permission: { billing: ['read', 7] },
        },
      ]));
    const organization = clientWith(fetchImpl).organization;

    await expect(
      organization.get({ organizationId: 'org-1' }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(
      organization.listRoles({ organizationId: 'org-1' }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('rejects malformed collections, totals, statuses, and explicit selector mismatches', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ not: 'an-array' }))
      .mockResolvedValueOnce(Response.json({ members: [], total: -1 }))
      .mockResolvedValueOnce(Response.json([
        { ...teamWire(), organizationId: 'foreign-org' },
      ]))
      .mockResolvedValueOnce(Response.json({
        ...invitationWire(),
        status: 'unknown',
      }));
    const organization = clientWith(fetchImpl).organization;

    await expect(organization.list()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(
      organization.listMembers({ organizationId: 'org-1' }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(
      organization.listTeams({ organizationId: 'org-1' }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(
      organization.inviteMember({
        organizationId: 'org-1',
        email: 'member@example.test',
        role: 'member',
      }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('rejects mixed active-tenant collections and foreign role rows', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([
        teamWire(),
        { ...teamWire(), id: 'team-2', organizationId: 'foreign-org' },
      ]))
      .mockResolvedValueOnce(Response.json({
        members: [
          memberWire(true),
          {
            ...memberWire(true),
            id: 'member-2',
            organizationId: 'foreign-org',
          },
        ],
        total: 2,
      }))
      .mockResolvedValueOnce(Response.json([
        invitationWire(),
        {
          ...invitationWire('invitation-2'),
          organizationId: 'foreign-org',
        },
      ]))
      .mockResolvedValueOnce(Response.json([
        {
          organizationId: 'foreign-org',
          role: 'billing_manager',
          permission: { billing: ['read'] },
        },
      ]));
    const organization = clientWith(fetchImpl).organization;

    await expect(organization.listTeams()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(organization.listMembers()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(organization.listInvitations()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(
      organization.listRoles({ organizationId: 'org-1' }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('preserves valid custom permission documents and rejects prototype keys', async () => {
    const prototypePermission = JSON.parse(
      '{"__proto__":["read"]}',
    ) as Record<string, unknown>;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([
        {
          organizationId: 'org-1',
          role: 'billing_manager',
          permission: {
            billing: ['read', 'refund'],
            'custom:ledger': ['export'],
          },
          token: 'drop-this-role-extra',
        },
      ]))
      .mockResolvedValueOnce(Response.json([
        {
          organizationId: 'org-1',
          role: 'unsafe',
          permission: prototypePermission,
        },
      ]));
    const organization = clientWith(fetchImpl).organization;

    await expect(
      organization.listRoles({ organizationId: 'org-1' }),
    ).resolves.toEqual({
      data: [{
        role: 'billing_manager',
        permission: {
          billing: ['read', 'refund'],
          'custom:ledger': ['export'],
        },
      }],
      error: null,
    });
    await expect(
      organization.listRoles({ organizationId: 'org-1' }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('rejects malformed mutation payloads before success hooks for every route', async () => {
    const cases: Array<{
      name: string;
      response?: unknown;
      invoke: (
        organization: ReturnType<typeof clientWith>['organization'],
        hooks: ActionFetchOptions,
      ) => Promise<unknown>;
    }> = [
      {
        name: 'create',
        invoke: (organization, hooks) =>
          organization.create({ name: 'Acme', slug: 'acme' }, hooks),
      },
      {
        name: 'setActive',
        invoke: (organization, hooks) =>
          organization.setActive({ organizationId: 'org-1' }, hooks),
      },
      {
        name: 'createTeam',
        invoke: (organization, hooks) =>
          organization.createTeam({ organizationId: 'org-1', name: 'Core' }, hooks),
      },
      {
        name: 'updateTeam',
        invoke: (organization, hooks) =>
          organization.updateTeam({
            teamId: 'team-1',
            data: { name: 'Platform', organizationId: 'org-1' },
          }, hooks),
      },
      {
        name: 'removeTeam',
        response: [],
        invoke: (organization, hooks) =>
          organization.removeTeam({ teamId: 'team-1', organizationId: 'org-1' }, hooks),
      },
      {
        name: 'addTeamMember',
        invoke: (organization, hooks) =>
          organization.addTeamMember({
            teamId: 'team-1',
            userId: 'user-1',
            organizationId: 'org-1',
          }, hooks),
      },
      {
        name: 'removeTeamMember',
        response: [],
        invoke: (organization, hooks) =>
          organization.removeTeamMember({
            teamId: 'team-1',
            userId: 'user-1',
            organizationId: 'org-1',
          }, hooks),
      },
      {
        name: 'setActiveTeam',
        invoke: (organization, hooks) =>
          organization.setActiveTeam({ teamId: 'team-1' }, hooks),
      },
      {
        name: 'update',
        invoke: (organization, hooks) =>
          organization.update({ organizationId: 'org-1', data: {} }, hooks),
      },
      {
        name: 'delete',
        invoke: (organization, hooks) =>
          organization.delete({ organizationId: 'org-1' }, hooks),
      },
      {
        name: 'inviteMember',
        invoke: (organization, hooks) =>
          organization.inviteMember({
            organizationId: 'org-1',
            email: 'member@example.test',
            role: 'member',
          }, hooks),
      },
      {
        name: 'acceptInvitation',
        invoke: (organization, hooks) =>
          organization.acceptInvitation({ invitationId: 'invitation-1' }, hooks),
      },
      {
        name: 'rejectInvitation',
        invoke: (organization, hooks) =>
          organization.rejectInvitation({ invitationId: 'invitation-1' }, hooks),
      },
      {
        name: 'cancelInvitation',
        invoke: (organization, hooks) =>
          organization.cancelInvitation({ invitationId: 'invitation-1' }, hooks),
      },
      {
        name: 'removeMember',
        invoke: (organization, hooks) =>
          organization.removeMember({
            organizationId: 'org-1',
            memberIdOrEmail: 'member-1',
          }, hooks),
      },
      {
        name: 'updateMemberRole',
        invoke: (organization, hooks) =>
          organization.updateMemberRole({
            organizationId: 'org-1',
            memberId: 'member-1',
            role: 'admin',
          }, hooks),
      },
      {
        name: 'leave',
        invoke: (organization, hooks) =>
          organization.leave({ organizationId: 'org-1' }, hooks),
      },
    ];

    for (const testCase of cases) {
      const fetchImpl = vi.fn(async () => Response.json(testCase.response ?? {})) as unknown as typeof fetch;
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const hooks: ActionFetchOptions = {
        onSuccess,
        onError,
      };
      const result = await testCase.invoke(
        clientWith(fetchImpl).organization,
        hooks,
      ) as { data: unknown; error: { code?: string } | null };

      expect(result.data, testCase.name).toBeNull();
      expect(result.error?.code, testCase.name).toBe('INVALID_RESPONSE');
      expect(onSuccess, testCase.name).not.toHaveBeenCalled();
      expect(onError, testCase.name).toHaveBeenCalledOnce();
      expect(onError, testCase.name).toHaveBeenCalledWith(
        expect.objectContaining({ failure: 'invalid_response' }),
      );
    }
  });

  it('accepts empty and absent display messages in destructive mutation receipts', async () => {
    const cases = [
      {
        name: 'removeTeam with an empty message',
        response: { message: '' },
        invoke: (organization: ReturnType<typeof clientWith>['organization'], hooks: ActionFetchOptions) =>
          organization.removeTeam({ teamId: 'team-1', organizationId: 'org-1' }, hooks),
      },
      {
        name: 'removeTeamMember with an absent message',
        response: {},
        invoke: (organization: ReturnType<typeof clientWith>['organization'], hooks: ActionFetchOptions) =>
          organization.removeTeamMember({
            teamId: 'team-1',
            userId: 'user-1',
            organizationId: 'org-1',
          }, hooks),
      },
    ];

    for (const testCase of cases) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(testCase.response));
      const onSuccess = vi.fn();
      const result = await testCase.invoke(clientWith(fetchImpl).organization, { onSuccess });

      expect(result, testCase.name).toEqual({ data: { message: '' }, error: null });
      expect(onSuccess, testCase.name).toHaveBeenCalledOnce();
    }
  });

  it('accepts the empty, null, and absent display strings the platform emits', async () => {
    // The SDK is its OWN producer of the empty display name: <SignUp> posts
    // `name: ''` under the default capability config, and the store column is
    // nullable, so a member with no display name is ordinary data - not a
    // malformed response. Rejecting it made one nameless member poison the whole
    // organization, including the receipts of `leave()` and `removeMember()`,
    // mutations the server had ALREADY performed.
    const detailsWith = (user: Record<string, unknown>) => ({
      ...organizationWire(),
      members: [{ ...memberWire(), user }],
      invitations: [],
    });
    const memberUser = (data: unknown) =>
      (data as OrganizationDetails | null)?.members[0]?.user;
    const cases: Array<{
      name: string;
      response: () => Response;
      invoke: (
        organization: ReturnType<typeof clientWith>['organization'],
      ) => Promise<unknown>;
      /** Read null-safely: a rejected decode yields `data: null`. */
      read: (data: unknown) => unknown;
      expected: unknown;
    }> = [
      {
        name: 'member with an empty display name',
        response: () => Response.json(detailsWith({
          id: 'user-1',
          name: '',
          email: 'member@example.test',
        })),
        invoke: (organization) => organization.get({ organizationId: 'org-1' }),
        read: memberUser,
        expected: { id: 'user-1', name: '', email: 'member@example.test' },
      },
      {
        name: 'member with a null display name',
        response: () => Response.json(detailsWith({
          id: 'user-1',
          name: null,
          email: 'member@example.test',
        })),
        invoke: (organization) => organization.get({ organizationId: 'org-1' }),
        // Coerced, NOT passed through: `name` stays a string so surfaces can
        // keep calling `.trim()` on it.
        read: (data) => memberUser(data)?.name,
        expected: '',
      },
      {
        name: 'member with a withheld email',
        response: () => Response.json(detailsWith({
          id: 'user-1',
          name: 'Member',
          email: null,
        })),
        invoke: (organization) => organization.get({ organizationId: 'org-1' }),
        // Preserved as null, never coerced: a withheld address has to stay
        // distinguishable from a present one.
        read: (data) => memberUser(data)?.email,
        expected: null,
      },
      {
        name: 'team with an empty name',
        response: () => Response.json([{ ...teamWire(), name: '' }]),
        invoke: (organization) => organization.listTeams({ organizationId: 'org-1' }),
        read: (data) => (data as OrganizationTeam[] | null)?.[0]?.name,
        expected: '',
      },
      {
        name: 'invitation with an empty email',
        response: () => Response.json([{ ...invitationWire(), email: '' }]),
        invoke: (organization) =>
          organization.listInvitations({ organizationId: 'org-1' }),
        read: (data) => (data as OrganizationInvitation[] | null)?.[0]?.email,
        expected: '',
      },
      {
        name: 'user invitation with no organizationName at all',
        response: () => Response.json([invitationWire()]),
        invoke: (organization) => organization.listUserInvitations(),
        read: (data) =>
          (data as OrganizationUserInvitation[] | null)?.[0]?.organizationName,
        expected: '',
      },
    ];

    // Collected into ONE table assertion rather than asserted per iteration, so
    // a regression reports every affected route instead of aborting on the first.
    const observed = [];
    for (const testCase of cases) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(testCase.response());
      const result = await testCase.invoke(
        clientWith(fetchImpl).organization,
      ) as { data: unknown; error: { code?: string } | null };
      observed.push({
        name: testCase.name,
        error: result.error?.code ?? null,
        value: testCase.read(result.data),
      });
    }

    expect(observed).toEqual(cases.map((testCase) => ({
      name: testCase.name,
      error: null,
      value: testCase.expected,
    })));
  });

  it('keeps rejecting the empty strings that are never merely blank', async () => {
    // The relaxation is scoped to DISPLAY strings. A blank slug, a blank role,
    // or a present-but-empty address is a malformed response, not a nameless
    // user: the first two are load-bearing identifiers, and an address is either
    // sent or withheld (null) - never sent empty.
    const cases: Array<{
      name: string;
      response: () => Response;
      invoke: (
        organization: ReturnType<typeof clientWith>['organization'],
      ) => Promise<unknown>;
    }> = [
      {
        name: 'organization with an empty slug',
        response: () => Response.json({
          ...organizationWire(),
          slug: '',
          members: [],
          invitations: [],
        }),
        invoke: (organization) => organization.get({ organizationId: 'org-1' }),
      },
      {
        name: 'member with an empty role',
        response: () => Response.json({ ...memberWire(), role: '' }),
        invoke: (organization) => organization.leave({ organizationId: 'org-1' }),
      },
      {
        name: 'member with a present-but-empty email',
        response: () => Response.json({
          ...organizationWire(),
          members: [{
            ...memberWire(),
            user: { id: 'user-1', name: 'Member', email: '' },
          }],
          invitations: [],
        }),
        invoke: (organization) => organization.get({ organizationId: 'org-1' }),
      },
    ];

    const observed = [];
    for (const testCase of cases) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(testCase.response());
      const result = await testCase.invoke(
        clientWith(fetchImpl).organization,
      ) as { data: unknown; error: { code?: string } | null };
      observed.push({
        name: testCase.name,
        data: result.data,
        error: result.error?.code ?? null,
      });
    }

    expect(observed).toEqual(cases.map((testCase) => ({
      name: testCase.name,
      data: null,
      error: 'INVALID_RESPONSE',
    })));
  });

  it('evaluates has()/hasPermission() locally and NEVER hits the network', async () => {
    // Advisory-boundary invariant (plan §3/§5): the client has() reads the local
    // membership claim - it must not route to /organization/has-permission (which
    // is blind to custom permissions and would wrongly deny them).
    const fetchImpl = vi.fn(async () => Response.json(null)) as unknown as typeof fetch;
    const organization = clientWith(fetchImpl).organization;

    expect(organization.has({ permission: 'org:billing:read' })).toBe(false);
    expect(organization.hasPermission({ permission: 'org:sys_roles:read' })).toBe(false);
    expect(organization.has({ role: 'billing_manager' })).toBe(false);

    const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls;
    expect(calls).toHaveLength(0);
  });

  it('keeps cross-project failures indistinguishable as typed 404 responses', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { code: 'ORGANIZATION_NOT_FOUND', message: 'Not found' },
        { status: 404, statusText: 'Not Found' },
      ),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).organization.get({ organizationId: 'foreign-org' });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ status: 404, code: 'ORGANIZATION_NOT_FOUND' });
  });

  it('refreshes session state and clears the JWT when active organization is unset', async () => {
    let mints = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (new URL(String(url)).pathname.endsWith('/token')) {
        mints += 1;
        const payload = btoa(JSON.stringify({
          sub: 'user-1',
          exp: Math.floor(Date.now() / 1000) + 900,
          mint: mints,
        }));
        return Response.json({ token: `header.${payload}.signature` });
      }
      return Response.json(null);
    }) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);

    const first = await client.getToken();
    expect(await client.getToken()).toBe(first);

    const result = await client.organization.setActive({ organizationId: null });

    expect(result).toEqual({ data: null, error: null });
    expect(await client.getToken()).not.toBe(first);
    expect(mints).toBe(2);
  });

  it('keeps the cached JWT when a set-active success payload is invalid', async () => {
    let mints = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (new URL(String(url)).pathname.endsWith('/token')) {
        mints += 1;
        const payload = btoa(JSON.stringify({
          sub: 'user-1',
          exp: Math.floor(Date.now() / 1000) + 900,
          mint: mints,
        }));
        return Response.json({ token: `header.${payload}.signature` });
      }
      return Response.json({ ...organizationWire(), id: 'foreign-org' });
    }) as unknown as typeof fetch;
    const client = clientWith(fetchImpl);
    const first = await client.getToken();

    const result = await client.organization.setActive({ organizationId: 'org-1' });

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    expect(await client.getToken()).toBe(first);
    expect(mints).toBe(1);
  });
});
