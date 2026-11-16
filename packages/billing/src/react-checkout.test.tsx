// @vitest-environment jsdom
import type { AuthOwlClient } from '@authowl/core';
import { act } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BILLING_SDK_POLICY } from './index';
import {
  CheckoutButton,
  CustomerPortalLink,
  useCheckout,
  useCheckoutReturn,
  useCustomerPortal,
  type UseCheckoutResult,
} from './react-commerce';
import {
  ALLOWED_LIST,
  deferred,
  makeCore,
  NOW,
  ok,
  settle,
  USER_ID,
  type WireReply,
} from './test-fixtures';

let currentCore: AuthOwlClient;
let currentUserId: string | null = USER_ID;

vi.mock('@authowl/react', () => ({
  useAuthClient: () => currentCore,
  useAuth: () => ({ isLoaded: true, isSignedIn: currentUserId !== null, userId: currentUserId }),
  useAuthOwlContext: () => ({ appearance: undefined }),
  useLocale: () => 'en',
  slot: (name: string) => `ao-${name}`,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  currentUserId = USER_ID;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('billing checkout React hooks', () => {
  it('writes a URL free marker before redirect navigation', async () => {
    const events: string[] = [];
    const assign = vi.fn(() => {
      const marker = JSON.parse(sessionStorage.getItem('authowl.billing.checkout.v1')!) as Record<string, unknown>;
      expect(marker).not.toHaveProperty('url');
      events.push('navigate');
    });
    vi.stubGlobal('location', { assign });
    const fixture = makeCore({ handler: async (path) => path.endsWith('/checkout') ? ok({
      status: 'redirect', url: 'https://payments.example.test/session',
      productId: 'pro', currency: 'USD', expiresAt: '2026-11-13T11:00:00.000Z',
    }) : ok({}) });
    currentCore = fixture.core;
    let checkout: UseCheckoutResult | undefined;
    function Probe() {
      checkout = useCheckout();
      return null;
    }
    render(<Probe />);
    let result: Awaited<ReturnType<UseCheckoutResult['start']>> | undefined;
    await act(async () => {
      result = await checkout!.start({ productId: 'pro', currency: 'USD' });
    });
    const marker = JSON.parse(sessionStorage.getItem('authowl.billing.checkout.v1')!) as Record<string, unknown>;
    expect(marker).toMatchObject({ productId: 'pro', currency: 'USD', userId: USER_ID, startedAt: NOW });
    expect(marker).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('url');
    expect(checkout!.result).not.toHaveProperty('url');
    expect(events).toEqual(['navigate']);

    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    act(() => window.dispatchEvent(pageshow));
    expect(checkout).toMatchObject({ status: 'idle', result: null });
  });

  it('re-enables checkout and shows the slow message after pending retries run out', async () => {
    const fixture = makeCore({ handler: async (path) => {
      if (path.endsWith('/products')) return ok(ONE_PRODUCT);
      if (path.endsWith('/entitlements')) return ok(ALLOWED_LIST);
      if (path.endsWith('/checkout')) return ok({ status: 'pending', retryAfterSeconds: 1 });
      return ok({});
    } });
    currentCore = fixture.core;
    const view = render(<CheckoutButton productId="pro" />);
    await act(async () => settle());
    const button = view.getByRole('button', { name: 'Subscribe to Pro' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(fixture.request.mock.calls.filter(([path]) => path.endsWith('/checkout'))).toHaveLength(4);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(view.getByRole('alert').textContent).toBe('This is taking longer than expected. Try again.');
  });

  it('keeps an active checkout successful when refresh fails and calls onComplete once', async () => {
    let entitlementReads = 0;
    const fixture = makeCore({ handler: async (path) => {
      if (path.endsWith('/products')) return ok(ONE_PRODUCT);
      if (path.endsWith('/entitlements')) {
        entitlementReads += 1;
        return entitlementReads === 1 ? ok(ALLOWED_LIST) : { status: 500 };
      }
      if (path.endsWith('/checkout')) return ok({ status: 'active', productId: 'pro' });
      return ok({});
    } });
    currentCore = fixture.core;
    const first = vi.fn();
    const view = render(<CheckoutButton productId="pro" onComplete={first} />);
    await act(async () => settle());
    fireEvent.click(view.getByRole('button', { name: 'Subscribe to Pro' }));
    await act(async () => settle());
    expect(first).toHaveBeenCalledOnce();
    const second = vi.fn();
    view.rerender(<CheckoutButton productId="pro" onComplete={second} />);
    await act(async () => settle());
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('drops a portal URL and resets the portal hook after a bfcache restore', async () => {
    vi.stubGlobal('location', { assign: vi.fn() });
    currentCore = makeCore({ handler: async (path) => path.endsWith('/portal') ? ok({
      status: 'redirect', url: 'https://portal.example.test/session',
      expiresAt: '2026-11-13T11:00:00.000Z',
    }) : ok(ALLOWED_LIST) }).core;
    let portal: ReturnType<typeof useCustomerPortal> | undefined;
    function Probe() {
      portal = useCustomerPortal();
      return null;
    }
    render(<Probe />);
    let result: Awaited<ReturnType<NonNullable<typeof portal>['open']>> | undefined;
    await act(async () => {
      result = await portal!.open();
    });
    expect(result).not.toHaveProperty('url');
    expect(portal!.status).toBe('redirecting');
    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    act(() => window.dispatchEvent(pageshow));
    expect(portal!.status).toBe('idle');
  });

  it.each([
    'product_unavailable',
    'checkout_unavailable',
    'not_connected',
    'no_organization',
    'role_required',
    'erased',
  ])('shows feedback for checkout status %s', async (status) => {
    currentCore = makeCore({ handler: async (path) => {
      if (path.endsWith('/products')) return ok(ONE_PRODUCT);
      if (path.endsWith('/entitlements')) return ok(ALLOWED_LIST);
      if (path.endsWith('/checkout')) return ok({ status });
      return ok({});
    } }).core;
    const view = render(<CheckoutButton productId="pro" />);
    await act(async () => settle());
    fireEvent.click(view.getByRole('button', { name: 'Subscribe to Pro' }));
    await act(async () => settle());
    expect(view.getByRole('alert').textContent).not.toBe('');
  });

  it.each(['not_connected', 'no_organization', 'role_required', 'no_customer', 'erased'])(
    'shows feedback for portal status %s',
    async (status) => {
      currentCore = makeCore({ handler: async (path) => {
        if (path.endsWith('/entitlements')) return ok(ALLOWED_LIST);
        if (path.endsWith('/portal')) return ok({ status });
        return ok({});
      } }).core;
      const view = render(<CustomerPortalLink />);
      await act(async () => settle());
      fireEvent.click(view.getByRole('button', { name: 'Manage billing' }));
      await act(async () => settle());
      expect(view.getByRole('alert').textContent).toBe('The billing portal could not be opened. Try again.');
    },
  );

  it('joins a double start into one checkout request', async () => {
    const pending = deferred<WireReply>();
    const fixture = makeCore({ handler: async (path) => path.endsWith('/checkout') ? pending.promise : ok({}) });
    currentCore = fixture.core;
    let checkout: UseCheckoutResult | undefined;
    function Probe() {
      checkout = useCheckout();
      return null;
    }
    render(<Probe />);
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = checkout!.start({ productId: 'pro', currency: 'USD' });
      second = checkout!.start({ productId: 'pro', currency: 'USD' });
    });
    expect(second).toBe(first);
    expect(fixture.request).toHaveBeenCalledOnce();
    pending.resolve(ok({ status: 'already_subscribed', productId: 'pro' }));
    await act(async () => first);
  });

  it('removes a marker for another user without showing return state', async () => {
    sessionStorage.setItem('authowl.billing.checkout.v1', JSON.stringify({
      productId: 'pro', currency: 'USD', userId: 'another-user', startedAt: NOW,
    }));
    currentCore = makeCore().core;
    let status = '';
    function Probe() {
      status = useCheckoutReturn().status;
      return null;
    }
    render(<Probe />);
    await act(async () => settle());
    expect(status).toBe('none');
    expect(sessionStorage.getItem('authowl.billing.checkout.v1')).toBeNull();
  });

  it('removes an expired marker without showing return state', async () => {
    sessionStorage.setItem('authowl.billing.checkout.v1', JSON.stringify({
      productId: 'pro', currency: 'USD', userId: USER_ID,
      startedAt: NOW - BILLING_SDK_POLICY.returnMarkerTtlMs - 1,
    }));
    currentCore = makeCore().core;
    let status = '';
    function Probe() {
      status = useCheckoutReturn().status;
      return null;
    }
    render(<Probe />);
    await act(async () => settle());
    expect(status).toBe('none');
    expect(sessionStorage.getItem('authowl.billing.checkout.v1')).toBeNull();
  });

  it('treats storage errors as no return state', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    currentCore = makeCore().core;
    let status = '';
    function Probe() {
      status = useCheckoutReturn().status;
      return null;
    }
    render(<Probe />);
    await act(async () => settle());
    expect(status).toBe('none');
  });

  it('ends as unconfirmed after the ruled polling schedule', async () => {
    sessionStorage.setItem('authowl.billing.checkout.v1', JSON.stringify({
      productId: 'pro', currency: 'USD', userId: USER_ID, startedAt: NOW,
    }));
    currentCore = makeCore({ replies: Array.from({ length: 12 }, () => ok({
      status: 'ok', subject: { type: 'user', id: USER_ID }, source: 'snapshot',
      fetchedAt: '2026-11-13T10:00:00.000Z', entitlements: [], subscription: null, canManage: true,
    })) }).core;
    let status = '';
    function Probe() {
      status = useCheckoutReturn().status;
      return null;
    }
    render(<Probe />);
    await act(async () => settle());
    expect(status).toBe('confirming');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BILLING_SDK_POLICY.returnPollScheduleMs.reduce((sum, value) => sum + value, 0));
    });
    expect(status).toBe('unconfirmed');
  });

  it('confirms the matching active subscription and calls onComplete once', async () => {
    sessionStorage.setItem('authowl.billing.checkout.v1', JSON.stringify({
      productId: 'pro', currency: 'USD', userId: USER_ID, startedAt: NOW,
    }));
    const active = ok({
      status: 'ok', subject: { type: 'user', id: USER_ID }, source: 'snapshot',
      fetchedAt: '2026-11-13T10:00:00.000Z', entitlements: [],
      subscription: { productId: 'pro', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false },
      canManage: true,
    });
    currentCore = makeCore({ replies: [active, active] }).core;
    const onComplete = vi.fn();
    let status = '';
    function Probe() {
      status = useCheckoutReturn({ onComplete }).status;
      return null;
    }
    render(<Probe />);
    await act(async () => settle());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BILLING_SDK_POLICY.returnPollScheduleMs[0]);
    });
    expect(status).toBe('confirmed');
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith('pro');
    expect(sessionStorage.getItem('authowl.billing.checkout.v1')).toBeNull();
  });
});

const ONE_PRODUCT = {
  status: 'ok', environment: 'sandbox', customerType: 'user', defaultCurrency: 'USD',
  currencies: ['USD'], providers: { USD: 'stripe' },
  products: [{
    id: 'pro', name: 'Pro',
    prices: [{
      currency: 'USD', amount: 900, exponent: 2, interval: 'month', intervalCount: 1,
      kind: 'fixed_recurring', hasUsage: false,
    }],
    features: [],
  }],
};
