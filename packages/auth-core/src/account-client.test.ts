import { describe, expect, it, vi } from 'vitest';
import { createAuthOwlClient } from './client';
import { resolveConfig } from './config';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const AUTH_PATH = `/api/projects/${PROJECT_ID}/auth`;

function clientWith(fetchImpl: typeof fetch) {
  return createAuthOwlClient(
    resolveConfig({
      publishableKey: PK,
      apiUrl: 'https://auth.example.com',
      fetch: fetchImpl,
    }),
  );
}

describe('account client', () => {
  it('routes the complete headless account lifecycle with stable wire shapes', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/list-sessions')) {
        return Response.json([
          {
            id: 'session-1',
            userId: 'user-1',
            createdAt: '2026-07-14T08:00:00.000Z',
            updatedAt: '2026-07-14T08:00:00.000Z',
            expiresAt: '2026-07-21T08:00:00.000Z',
            token: 'must-be-dropped',
          },
        ]);
      }
      if (path.endsWith('/list-accounts')) {
        return Response.json([
          {
            id: 'account-credential',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
            scopes: [],
            createdAt: '2026-07-14T08:00:00.000Z',
            updatedAt: '2026-07-14T08:00:00.000Z',
            accessToken: 'must-be-dropped',
          },
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'google',
            accountId: 'google-user',
            scopes: ['openid'],
            createdAt: '2026-07-14T08:00:00.000Z',
            updatedAt: '2026-07-14T08:00:00.000Z',
            accessToken: 'must-be-dropped',
          },
        ]);
      }
      if (path.endsWith('/change-password')) {
        return Response.json({
          user: {
            id: 'user-1',
            email: 'mona@example.test',
            emailVerified: true,
            createdAt: '2026-07-14T08:00:00.000Z',
            updatedAt: '2026-07-14T08:00:00.000Z',
          },
        });
      }
      if (path.endsWith('/link-social')) {
        return Response.json({
          url: 'https://accounts.example.test/authorize',
          redirect: true,
        });
      }
      if (path.endsWith('/delete-user')) {
        return Response.json({ success: true, message: 'Deleted.' });
      }
      return Response.json({ status: true, success: true });
    }) as unknown as typeof fetch;
    const account = clientWith(fetchImpl).account;
    const options = { headers: { 'x-test': 'account' } };

    await account.updateProfile({ name: 'Mona', image: null }, options);
    await account.changeEmail({ newEmail: 'mona@example.test', callbackURL: '/profile' }, options);
    await account.changePassword({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    }, options);
    const sessions = await account.listSessions();
    const revokeInput = {
      sessionId: 'session-1',
      token: 'legacy-token-must-not-be-sent',
    };
    await account.revokeSession(revokeInput, options);
    await account.revokeOtherSessions(options);
    const socialAccounts = await account.listSocialAccounts();
    await account.linkSocial({ provider: 'google', callbackURL: '/profile' }, options);
    await account.unlinkSocial({ providerId: 'google', accountId: 'google-user' }, options);
    await account.delete({}, options);

    expect(sessions.data?.[0]?.createdAt).toBeInstanceOf(Date);
    expect(sessions.data?.[0]?.expiresAt).toBeInstanceOf(Date);
    expect(socialAccounts.data?.[0]?.updatedAt).toBeInstanceOf(Date);
    expect(socialAccounts.data).toHaveLength(1);
    expect(socialAccounts.data?.[0]?.providerId).toBe('google');
    expect(socialAccounts.data?.[0]?.canUnlink).toBe(true);
    expect(JSON.stringify(sessions.data)).not.toContain('must-be-dropped');
    expect(JSON.stringify(socialAccounts.data)).not.toContain('must-be-dropped');

    const calls = (
      fetchImpl as unknown as { mock: { calls: [string | URL, RequestInit][] } }
    ).mock.calls;
    expect(calls.map(([url, init]) => `${init.method ?? 'GET'} ${new URL(String(url)).pathname}`))
      .toEqual([
        `POST ${AUTH_PATH}/update-user`,
        `POST ${AUTH_PATH}/change-email`,
        `POST ${AUTH_PATH}/change-password`,
        `GET ${AUTH_PATH}/list-sessions`,
        `POST ${AUTH_PATH}/revoke-session`,
        `POST ${AUTH_PATH}/revoke-other-sessions`,
        `GET ${AUTH_PATH}/list-accounts`,
        `POST ${AUTH_PATH}/link-social`,
        `POST ${AUTH_PATH}/unlink-account`,
        `POST ${AUTH_PATH}/delete-user`,
      ]);
    expect(JSON.parse(String(calls[5]?.[1].body))).toEqual({});
    expect(JSON.parse(String(calls[9]?.[1].body))).toEqual({});
    expect(JSON.parse(String(calls[4]?.[1].body))).toEqual({ sessionId: 'session-1' });
  });

  it('surfaces fresh-session policy as a typed code, not a raw-message contract', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { code: 'SESSION_NOT_FRESH', message: 'Sign in again.' },
        { status: 403, statusText: 'Forbidden' },
      ),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).account.changeEmail({
      newEmail: 'new@example.test',
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ status: 403, code: 'SESSION_NOT_FRESH' });
  });

  it('protects a social provider when it is the last sign-in method', async () => {
    const fetchImpl = vi.fn(async () => Response.json([
      {
        id: 'account-google',
        userId: 'user-1',
        providerId: 'google',
        accountId: 'google-user',
        scopes: ['openid'],
        createdAt: '2026-07-14T08:00:00.000Z',
        updatedAt: '2026-07-14T08:00:00.000Z',
      },
    ])) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).account.listSocialAccounts();

    expect(result.data).toMatchObject([{ providerId: 'google', canUnlink: false }]);
  });

  it('returns INVALID_RESPONSE instead of throwing on malformed account payloads', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ not: 'an array' }))
      .mockResolvedValueOnce(Response.json([{ id: 'missing-required-fields' }]))
      .mockResolvedValueOnce(Response.json({ status: 'yes' }));
    const account = clientWith(fetchImpl).account;

    await expect(account.listSocialAccounts()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(account.listSessions()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(account.updateProfile({ name: 'Mona' })).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
  });
});
