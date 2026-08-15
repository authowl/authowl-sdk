import { describe, expect, it, vi } from 'vitest';
import { createFetchAccessToken } from './fetch-access-token';

describe('createFetchAccessToken (the Convex AuthTokenFetcher bridge)', () => {
  it('force-refreshes its FIRST call, then maps forceRefreshToken through', async () => {
    const getToken = vi.fn(async () => 'jwt');
    const fetchAccessToken = createFetchAccessToken(getToken);

    // First call of a generation: forced regardless, so a new Convex auth
    // generation (org switch, sign-in) can never be handed a token cached for
    // the previous identity.
    await expect(fetchAccessToken({ forceRefreshToken: false })).resolves.toBe('jwt');
    expect(getToken).toHaveBeenLastCalledWith({ template: 'convex', forceRefresh: true });

    // Steady state: the flag maps through verbatim.
    await expect(fetchAccessToken({ forceRefreshToken: false })).resolves.toBe('jwt');
    expect(getToken).toHaveBeenLastCalledWith({ template: 'convex', forceRefresh: false });

    // Convex's scheduled refresh + auth-error retry: MUST reach the server.
    await expect(fetchAccessToken({ forceRefreshToken: true })).resolves.toBe('jwt');
    expect(getToken).toHaveBeenLastCalledWith({ template: 'convex', forceRefresh: true });
  });

  it('each instance forces its own first call (one instance per auth generation)', async () => {
    const getToken = vi.fn(async (_options?: { template?: string; forceRefresh?: boolean }) => 'jwt');
    await createFetchAccessToken(getToken)({ forceRefreshToken: false });
    await createFetchAccessToken(getToken)({ forceRefreshToken: false });
    expect(getToken.mock.calls.map(([options]) => options)).toEqual([
      { template: 'convex', forceRefresh: true },
      { template: 'convex', forceRefresh: true },
    ]);
  });

  it('passes through the signed-out null', async () => {
    const fetchAccessToken = createFetchAccessToken(async () => null);
    await expect(fetchAccessToken({ forceRefreshToken: false })).resolves.toBeNull();
  });

  it('maps errors to null - Convex treats null as unauthenticated, a throw breaks it', async () => {
    const fetchAccessToken = createFetchAccessToken(async () => {
      throw new Error('network down');
    });
    await expect(fetchAccessToken({ forceRefreshToken: true })).resolves.toBeNull();
  });
});
