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

  it('notifies subscribers only after a write has ended older joins', async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    const request = vi.fn((path: string) =>
      path === '/organization/update'
        ? Promise.resolve({ data: null, error: null })
        : new Promise((resolve) => resolvers.push(resolve)));
    const organization = clientWith(request as unknown as ReturnType<typeof vi.fn>);
    const listener = vi.fn(() => {
      void organization.get({ organizationId: 'org-1' });
    });
    organization.subscribe(listener);

    void organization.get({ organizationId: 'org-1' });
    expect(request).toHaveBeenCalledTimes(1);

    await organization.update({ organizationId: 'org-1', data: { name: 'Renamed' } });

    // The subscriber's read must not be handed the still-open pre-write read.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(3);
    resolvers.forEach((resolve) => resolve({ data: null, error: null }));
  });

  it('does not notify subscribers for reads or failed writes', async () => {
    const request = vi.fn(async (path: string) => path === '/organization/update'
      ? { data: null, error: { code: 'UPDATE_FAILED', message: 'nope' } }
      : { data: [], error: null });
    const organization = clientWith(request as unknown as ReturnType<typeof vi.fn>);
    const listener = vi.fn();
    organization.subscribe(listener);

    await organization.list();
    await organization.update({ organizationId: 'org-1', data: { name: 'Renamed' } });

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a committed mutation successful when a subscriber throws', async () => {
    const request = vi.fn(async () => ({
      data: { id: 'org-1', name: 'Renamed', slug: 'renamed', createdAt: new Date() },
      error: null,
    }));
    const organization = clientWith(request as unknown as ReturnType<typeof vi.fn>);
    const healthyListener = vi.fn();
    organization.subscribe(() => {
      throw new Error('consumer listener failed');
    });
    organization.subscribe(healthyListener);

    await expect(
      organization.update({ organizationId: 'org-1', data: { name: 'Renamed' } }),
    ).resolves.toMatchObject({ error: null });
    expect(healthyListener).toHaveBeenCalledTimes(1);
  });
});
