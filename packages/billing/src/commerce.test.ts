// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BILLING_SDK_POLICY,
  BillingRequestError,
  createBillingClient,
  type BillingClient,
} from './index';
import { deferred, makeCore, NOW, ok, settle, type WireReply } from './test-fixtures';

const CATALOG = {
  status: 'ok',
  environment: 'sandbox',
  customerType: 'user',
  defaultCurrency: 'USD',
  currencies: ['USD'],
  providers: { USD: 'stripe' },
  products: [{
    id: 'pro',
    name: 'Pro',
    prices: [{
      currency: 'USD',
      amount: 2_500,
      exponent: 2,
      interval: 'month',
      intervalCount: 1,
      kind: 'fixed_recurring',
      hasUsage: false,
    }],
    features: [],
  }],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('billing commerce client', () => {
  it('caches a catalog, exposes snapshots and refetches after the stale boundary', async () => {
    const fixture = makeCore({ replies: [ok(CATALOG), ok(CATALOG)] });
    const billing = createBillingClient(fixture.core);
    const listener = vi.fn();
    const unsubscribe = billing.subscribeCatalog(listener);
    expect(billing.getCatalogSnapshot()).toEqual({
      status: 'idle', catalog: null, error: null,
    });

    const first = billing.products();
    expect(billing.getCatalogSnapshot().status).toBe('loading');
    await expect(first).resolves.toEqual(CATALOG);
    expect(billing.getCatalogSnapshot()).toMatchObject({ status: 'ready', catalog: CATALOG });
    await billing.products();
    expect(fixture.request).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + BILLING_SDK_POLICY.catalogStaleAfterMs);
    await billing.products();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('joins concurrent catalog reads and publishes a safe error snapshot', async () => {
    const pending = deferred<WireReply>();
    const fixture = makeCore({ handler: () => pending.promise });
    const billing = createBillingClient(fixture.core);
    const first = billing.products();
    const second = billing.products();
    expect(second).toBe(first);
    pending.resolve({ status: 503, code: 'BILLING_UNAVAILABLE', retryAfterSeconds: 5 });
    await expect(first).rejects.toBeInstanceOf(BillingRequestError);
    expect(billing.getCatalogSnapshot()).toMatchObject({
      status: 'error',
      catalog: null,
      error: { status: 503, code: 'BILLING_UNAVAILABLE', retryAfterSeconds: 5 },
    });
  });

  it('folds pending checkout replies and posts the same fields each time', async () => {
    const replies = [
      ...Array.from({ length: BILLING_SDK_POLICY.checkoutPendingRetries }, () => ok({
        status: 'pending', retryAfterSeconds: 3,
      })),
      ok({ status: 'redirect', url: 'https://checkout.example.test/pay', productId: 'pro', currency: 'USD', expiresAt: '2026-11-16T12:00:00.000Z' }),
    ];
    const fixture = makeCore({ replies });
    const billing = createBillingClient(fixture.core);
    const checkout = billing.checkout({ productId: 'pro', currency: 'USD', returnPath: '/plans' });
    await vi.runAllTimersAsync();
    await expect(checkout).resolves.toMatchObject({ status: 'redirect' });
    expect(fixture.request).toHaveBeenCalledTimes(4);
    for (const [path, request] of fixture.request.mock.calls) {
      expect(path).toBe('/billing/checkout');
      expect(request).toMatchObject({
        method: 'POST',
        body: { productId: 'pro', currency: 'USD', returnPath: '/plans' },
        timeoutMs: BILLING_SDK_POLICY.checkoutTimeoutMs,
      });
    }
  });

  it('stops after the configured pending retries and drops response details', async () => {
    const fixture = makeCore({ replies: Array.from(
      { length: BILLING_SDK_POLICY.checkoutPendingRetries + 1 },
      () => ok({ status: 'pending', retryAfterSeconds: 1 }),
    ) });
    const billing = createBillingClient(fixture.core);
    const checkout = billing.checkout({ productId: 'pro', currency: 'USD' });
    await vi.runAllTimersAsync();
    await expect(checkout).resolves.toEqual({ status: 'pending' });
    expect(fixture.request).toHaveBeenCalledTimes(
      BILLING_SDK_POLICY.checkoutPendingRetries + 1,
    );
  });

  it('returns one in flight promise per product and currency without caching results', async () => {
    const pending = deferred<WireReply>();
    const fixture = makeCore({
      handler: vi.fn()
        .mockImplementationOnce(() => pending.promise)
        .mockResolvedValueOnce(ok({ status: 'active', productId: 'pro' })),
    });
    const billing = createBillingClient(fixture.core);
    const first = billing.checkout({ productId: 'pro', currency: 'USD' });
    const second = billing.checkout({ productId: 'pro', currency: 'USD' });
    expect(second).toBe(first);
    expect(fixture.request).toHaveBeenCalledOnce();
    pending.resolve(ok({ status: 'active', productId: 'pro' }));
    await first;
    await expect(billing.checkout({ productId: 'pro', currency: 'USD' }))
      .resolves.toEqual({ status: 'active', productId: 'pro' });
    expect(fixture.request).toHaveBeenCalledTimes(2);
  });

  it('mints a portal session without storing its result', async () => {
    const redirect = {
      status: 'redirect',
      url: 'https://portal.example.test/s/token',
      expiresAt: '2026-11-16T12:00:00.000Z',
    };
    const fixture = makeCore({ replies: [ok(redirect), ok(redirect)] });
    const billing = createBillingClient(fixture.core);
    await expect(billing.portal({ returnPath: '/account' })).resolves.toEqual(redirect);
    await expect(billing.portal()).resolves.toEqual(redirect);
    expect(fixture.request.mock.calls[0]).toEqual([
      '/billing/portal',
      expect.objectContaining({
        method: 'POST',
        body: { returnPath: '/account' },
        timeoutMs: BILLING_SDK_POLICY.portalTimeoutMs,
      }),
    ]);
    expect(fixture.request.mock.calls[1]![1].body).toEqual({});
  });

  it('adds subscription authority to the entitlement snapshot', async () => {
    const fixture = makeCore({ replies: [ok({
      status: 'ok',
      subject: { type: 'user', id: 'user-1' },
      source: 'snapshot',
      fetchedAt: '2026-11-16T12:00:00.000Z',
      entitlements: [],
      subscription: {
        productId: 'pro',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      canManage: true,
    })] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.getSnapshot()).toMatchObject({
      subscription: { productId: 'pro', status: 'active' },
      canManage: true,
    });
    unsubscribe();
  });
});

function forbiddenParameterTypeAssertions(billing: BillingClient): void {
  // @ts-expect-error environment is selected by the publishable key.
  void billing.checkout({ productId: 'pro', currency: 'USD', environment: 'live' });
  // @ts-expect-error sandbox is not a checkout parameter.
  void billing.checkout({ productId: 'pro', currency: 'USD', sandbox: true });
  // @ts-expect-error live is not a checkout parameter.
  void billing.checkout({ productId: 'pro', currency: 'USD', live: true });
  // @ts-expect-error price is selected by product and currency on the server.
  void billing.checkout({ productId: 'pro', currency: 'USD', price: 25 });
  // @ts-expect-error amount is selected by product and currency on the server.
  void billing.checkout({ productId: 'pro', currency: 'USD', amount: 2_500 });
  // @ts-expect-error idempotency keys are created and stored by the server.
  void billing.checkout({ productId: 'pro', currency: 'USD', idempotencyKey: 'not-client-owned' });
}

void forbiddenParameterTypeAssertions;
