// @vitest-environment jsdom
import type { AuthOwlClient } from '@authowl/core';
import { act } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BILLING_SDK_POLICY } from './index';
import { useCheckout, useCheckoutReturn, type UseCheckoutResult } from './react';
import { deferred, makeCore, NOW, ok, settle, USER_ID, type WireReply } from './test-fixtures';

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
    const assign = vi.fn(() => events.push('navigate'));
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
    await act(async () => {
      await checkout!.start({ productId: 'pro', currency: 'USD' });
    });
    const marker = JSON.parse(sessionStorage.getItem('authowl.billing.checkout.v1')!) as Record<string, unknown>;
    expect(marker).toMatchObject({ productId: 'pro', currency: 'USD', userId: USER_ID, startedAt: NOW });
    expect(marker).not.toHaveProperty('url');
    expect(events).toEqual(['navigate']);
  });

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
