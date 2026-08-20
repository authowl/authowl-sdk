import { describe, expect, it, vi } from 'vitest';
import { createOrganizationClient } from './organization-client';
import type { AuthHttpClient } from './http-client';

/**
 * `useOrganization()` fetches per consumer, so one page render asked the server
 * for the same organization once per component - a dozen identical requests for
 * a single load. Reads that are open at the same time now share one request.
 *
 * The line these pin is the one that makes it safe: this is a JOIN, not a cache.
 * Nothing survives a settled request, so it can never serve anything staler than
 * a request still in flight.
 */
function clientWith(request: ReturnType<typeof vi.fn>) {
  return createOrganizationClient({ request } as unknown as AuthHttpClient, () => {});
}

function deferredRequest() {
  const resolvers: ((value: unknown) => void)[] = [];
  const request = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
  return { request, resolvers };
}

describe('organization reads open at the same time', () => {
  it('share one request and each receive the answer', async () => {
    const { request, resolvers } = deferredRequest();
    const organization = clientWith(request);

    const both = Promise.all([
      organization.get({ organizationId: 'org-1' }),
      organization.get({ organizationId: 'org-1' }),
    ]);
    expect(request).toHaveBeenCalledTimes(1);

    resolvers.forEach((resolve) => resolve({ data: null, error: null }));
    const [first, second] = await both;
    expect(first).toEqual(second);
  });

  it('does not join reads of different things', async () => {
    const { request, resolvers } = deferredRequest();
    const organization = clientWith(request);

    void organization.get({ organizationId: 'org-1' });
    void organization.get({ organizationId: 'org-2' });

    expect(request).toHaveBeenCalledTimes(2);
    resolvers.forEach((resolve) => resolve({ data: null, error: null }));
  });

  it('is a join and NOT a cache: a later read is a real read', async () => {
    const request = vi.fn(async () => ({ data: null, error: null }));
    const organization = clientWith(request as unknown as ReturnType<typeof vi.fn>);

    await organization.get({ organizationId: 'org-1' });
    await organization.get({ organizationId: 'org-1' });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('gives a caller with its own fetch options its own request', async () => {
    const { request, resolvers } = deferredRequest();
    const organization = clientWith(request);

    void organization.get({ organizationId: 'org-1' });
    void organization.get({ organizationId: 'org-1' }, { signal: new AbortController().signal });

    // Joining would hand this caller a promise someone else can abort.
    expect(request).toHaveBeenCalledTimes(2);
    resolvers.forEach((resolve) => resolve({ data: null, error: null }));
  });

  it('never lets a read that started before a write be joined after it', async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    const request = vi.fn((path: string) =>
      path === '/organization/update'
        ? Promise.resolve({ data: null, error: null })
        : new Promise((resolve) => resolvers.push(resolve)));
    const organization = clientWith(request as unknown as ReturnType<typeof vi.fn>);

    void organization.get({ organizationId: 'org-1' });
    expect(request).toHaveBeenCalledTimes(1);

    await organization.update({ organizationId: 'org-1', data: { name: 'Renamed' } });
    void organization.get({ organizationId: 'org-1' });

    // The pre-write read is still open; this reader must not be handed it.
    expect(request).toHaveBeenCalledTimes(3);
    resolvers.forEach((resolve) => resolve({ data: null, error: null }));
  });
});
