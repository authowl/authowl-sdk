// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BILLING_SDK_POLICY,
  BillingRequestError,
  createBillingClient,
  type BillingSnapshot,
} from './index';
import { hasEntitlement } from './store';
import {
  ALLOWED_LIST,
  BASELINE,
  deferred,
  makeCore,
  NOW,
  ok,
  ORG_ID,
  sessionState,
  setVisibility,
  settle,
  USER_ID,
  type WireReply,
} from './test-fixtures';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('billing store', () => {
  it.each([
    ['loading status', { status: 'loading' }],
    ['error status', { status: 'error' }],
    ['stale flag', { stale: true }],
    ['no_customer reason', { reason: 'no_customer' }],
    ['signed_out status', { status: 'signed_out' }],
    ['denied row', {
      entitlements: [{ ...ALLOWED_LIST.entitlements[0], allowed: false }],
    }],
  ] as const)('fails closed when only the %s changes', (_name, change) => {
    expect(hasEntitlement(BASELINE, 'reports', NOW)).toBe(true);
    expect(hasEntitlement({ ...BASELINE, ...change } as BillingSnapshot, 'reports', NOW)).toBe(false);
  });

  it('fails closed from the clock even when the stale timer did not fire', () => {
    expect(hasEntitlement(BASELINE, 'reports', NOW)).toBe(true);
    vi.setSystemTime(NOW + BILLING_SDK_POLICY.staleAfterMs);
    expect(hasEntitlement(BASELINE, 'reports', Date.now())).toBe(false);
  });

  it('fails closed for an unknown feature and when the clock moves backwards', () => {
    expect(hasEntitlement(BASELINE, 'exports', NOW)).toBe(false);
    expect(hasEntitlement(BASELINE, 'reports', NOW - 1)).toBe(false);
  });

  it.each([
    ['user', '00000000-0000-4000-8000-000000000004', null],
    ['organization', USER_ID, ORG_ID],
  ] as const)('discards a late answer after a %s identity change', async (
    _name,
    nextUserId,
    nextOrganizationId,
  ) => {
    const late = deferred<WireReply>();
    const current = deferred<WireReply>();
    const fixture = makeCore({
      handler: vi.fn()
        .mockResolvedValueOnce(ok(ALLOWED_LIST))
        .mockImplementationOnce(() => late.promise)
        .mockImplementationOnce(() => current.promise),
    });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.has({ feature: 'reports' })).toBe(true);

    window.dispatchEvent(new Event('focus'));
    fixture.setSession(nextUserId, nextOrganizationId);
    expect(billing.getSnapshot()).toMatchObject({ status: 'loading', entitlements: [] });
    expect(billing.has({ feature: 'reports' })).toBe(false);
    late.resolve(ok(ALLOWED_LIST));
    await settle();
    expect(billing.getSnapshot()).toMatchObject({ status: 'loading', entitlements: [] });
    expect(billing.has({ feature: 'reports' })).toBe(false);
    current.resolve(ok(ALLOWED_LIST));
    await settle();
    expect(billing.getSnapshot().status).toBe('ready');
    unsubscribe();
  });

  it('resets after the last unsubscribe and never revives the previous identity', async () => {
    const fixture = makeCore({ replies: [ok(ALLOWED_LIST), ok(ALLOWED_LIST)] });
    const billing = createBillingClient(fixture.core);
    const firstUnsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.has({ feature: 'reports' })).toBe(true);
    firstUnsubscribe();
    await settle();
    expect(billing.getSnapshot()).toBe(billing.getServerSnapshot());
    expect(billing.has({ feature: 'reports' })).toBe(false);

    fixture.setSession('00000000-0000-4000-8000-000000000004', ORG_ID);
    expect(billing.getSnapshot().status).toBe('signed_out');
    const secondUnsubscribe = billing.subscribe(vi.fn());
    expect(billing.getSnapshot().status).toBe('loading');
    expect(billing.has({ feature: 'reports' })).toBe(false);
    await settle();
    secondUnsubscribe();
  });

  it.each([
    ['pending', sessionState(null, null, { pending: true }), 'loading'],
    ['read error', sessionState(null, null, { error: true }), 'error'],
    ['settled signed out', sessionState(null, null), 'signed_out'],
  ] as const)('maps a %s session without a request', (_name, state, status) => {
    const fixture = makeCore({ state });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    expect(billing.getSnapshot().status).toBe(status);
    expect(fixture.request).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('joins paired idle triggers to one request in flight', async () => {
    const pending = deferred<WireReply>();
    const fixture = makeCore({ handler: () => pending.promise });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    setVisibility('visible');
    expect(fixture.request).toHaveBeenCalledTimes(1);
    pending.resolve(ok(ALLOWED_LIST));
    await settle();
    unsubscribe();
  });

  it('queues one fresh request for public refresh and resolves with it', async () => {
    const second = deferred<WireReply>();
    const third = deferred<WireReply>();
    const fixture = makeCore({
      handler: vi.fn()
        .mockResolvedValueOnce(ok(ALLOWED_LIST))
        .mockImplementationOnce(() => second.promise)
        .mockImplementationOnce(() => third.promise),
    });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    window.dispatchEvent(new Event('focus'));
    const refreshed = billing.refresh();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    second.resolve(ok(ALLOWED_LIST));
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(3);
    let resolved = false;
    void refreshed.then(() => { resolved = true; });
    await settle();
    expect(resolved).toBe(false);
    third.resolve(ok({ ...ALLOWED_LIST, entitlements: [] }));
    await refreshed;
    expect(billing.has({ feature: 'reports' })).toBe(false);
    unsubscribe();
  });

  it.each([
    ['policy backoff', { status: 500 }, BILLING_SDK_POLICY.backoffMs[0]],
    ['retry-after', { status: 429, retryAfterSeconds: 7 }, 7_000],
  ] as const)('holds a queued refresh behind %s with one retry timer', async (
    _name,
    failure,
    delay,
  ) => {
    setVisibility('hidden');
    const first = deferred<WireReply>();
    const fixture = makeCore({
      handler: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(ok(ALLOWED_LIST)),
    });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    const refreshed = billing.refresh();
    first.resolve(failure);
    await refreshed;
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('settles a queued refresh with signed out after sign-out', async () => {
    const first = deferred<WireReply>();
    const fixture = makeCore({ handler: () => first.promise });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    const refreshed = billing.refresh();
    fixture.setSession(null, null);
    await refreshed;
    expect(billing.getSnapshot()).toBe(billing.getServerSnapshot());
    first.resolve(ok(ALLOWED_LIST));
    await settle();
    expect(billing.getSnapshot()).toBe(billing.getServerSnapshot());
    unsubscribe();
  });

  it('does not duplicate a request after a user switch settles a queue', async () => {
    const oldUser = deferred<WireReply>();
    const newUser = deferred<WireReply>();
    const fixture = makeCore({
      handler: vi.fn()
        .mockImplementationOnce(() => oldUser.promise)
        .mockImplementationOnce(() => newUser.promise),
    });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    const refreshed = billing.refresh();
    fixture.setSession('00000000-0000-4000-8000-000000000004', null);
    await refreshed;
    expect(fixture.request).toHaveBeenCalledTimes(2);
    newUser.resolve(ok(ALLOWED_LIST));
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    oldUser.resolve(ok({ ...ALLOWED_LIST, entitlements: [] }));
    await settle();
    expect(billing.has({ feature: 'reports' })).toBe(true);
    expect(fixture.request).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('keeps pending MFA enrollment signed out and fetches when it completes', async () => {
    const fixture = makeCore({ state: sessionState(USER_ID, null, { pendingMfa: true }) });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    expect(billing.getSnapshot()).toBe(billing.getServerSnapshot());
    expect(fixture.request).not.toHaveBeenCalled();
    fixture.setSession(USER_ID, null, { pendingMfa: false });
    expect(fixture.request).toHaveBeenCalledOnce();
    await settle();
    expect(billing.getSnapshot().status).toBe('ready');
    unsubscribe();
  });

  it('is safe to construct and subscribe without window', () => {
    const fixture = makeCore();
    vi.stubGlobal('window', undefined);
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    expect(billing.getSnapshot().status).toBe('signed_out');
    expect(fixture.request).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('turns a transport failure into an empty error snapshot', async () => {
    const fixture = makeCore({ handler: async () => { throw new Error('offline'); } });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.getSnapshot()).toMatchObject({ status: 'error', entitlements: [] });
    expect(billing.getSnapshot().error).toBeInstanceOf(BillingRequestError);
    unsubscribe();
  });

  it('progresses through policy backoff delays', async () => {
    const fixture = makeCore({ replies: [{ status: 500 }, { status: 500 }, ok(ALLOWED_LIST)] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    await vi.advanceTimersByTimeAsync(BILLING_SDK_POLICY.backoffMs[0]);
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(BILLING_SDK_POLICY.backoffMs[1] - 1);
    expect(fixture.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('honors retry-after for 503 responses', async () => {
    const fixture = makeCore({
      replies: [{ status: 503, retryAfterSeconds: 7 }, ok(ALLOWED_LIST)],
    });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    await vi.advanceTimersByTimeAsync(6999);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('caps retry-after at sixty seconds', async () => {
    const fixture = makeCore({
      replies: [{ status: 503, retryAfterSeconds: 86_400 }, ok(ALLOWED_LIST)],
    });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('ignores retry-after for statuses other than 429 and 503', async () => {
    const fixture = makeCore({
      replies: [{ status: 500, retryAfterSeconds: 50 }, ok(ALLOWED_LIST)],
    });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    await vi.advanceTimersByTimeAsync(BILLING_SDK_POLICY.backoffMs[0]);
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('refreshes on focus, visibility, online and the visible interval', async () => {
    const fixture = makeCore({ replies: Array.from({ length: 5 }, () => ok(ALLOWED_LIST)) });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    window.dispatchEvent(new Event('focus'));
    await settle();
    setVisibility('hidden');
    setVisibility('visible');
    await settle();
    window.dispatchEvent(new Event('online'));
    await settle();
    await vi.advanceTimersByTimeAsync(BILLING_SDK_POLICY.refreshIntervalMs);
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(5);
    unsubscribe();
  });

  it('publishes stale and notifies exactly at the stale boundary', async () => {
    const fixture = makeCore({ replies: [ok(ALLOWED_LIST)] });
    const billing = createBillingClient(fixture.core);
    const listener = vi.fn();
    const unsubscribe = billing.subscribe(listener);
    await settle();
    setVisibility('hidden');
    listener.mockClear();
    await vi.advanceTimersByTimeAsync(BILLING_SDK_POLICY.staleAfterMs - 1);
    expect(listener).not.toHaveBeenCalled();
    expect(billing.has({ feature: 'reports' })).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(billing.getSnapshot()).toMatchObject({ status: 'ready', stale: true });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('maps 401 to signed out', async () => {
    const fixture = makeCore({ replies: [{ status: 401 }] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.getSnapshot().status).toBe('signed_out');
    unsubscribe();
  });

  it('returns one client per core client', () => {
    const first = makeCore();
    const second = makeCore();
    expect(createBillingClient(first.core)).toBe(createBillingClient(first.core));
    expect(createBillingClient(first.core)).not.toBe(createBillingClient(second.core));
  });

  it('returns one client across separately evaluated package copies', async () => {
    const fixture = makeCore();
    const first = createBillingClient(fixture.core);
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.createBillingClient(fixture.core)).toBe(first);
  });

  it('recognizes request errors across separately evaluated package copies', async () => {
    const fixture = makeCore({ replies: [{ status: 503 }] });
    const first = createBillingClient(fixture.core);
    vi.resetModules();
    const fresh = await import('./index');
    const error = await first.check({ feature: 'reports' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BillingRequestError);
    expect(error).toBeInstanceOf(fresh.BillingRequestError);
  });

  it('keeps a ready snapshot across a synchronous subscriber swap', async () => {
    const fixture = makeCore();
    const billing = createBillingClient(fixture.core);
    const unsubscribeA = billing.subscribe(vi.fn());
    await settle();
    const ready = billing.getSnapshot();
    expect(billing.has({ feature: 'reports' })).toBe(true);

    unsubscribeA();
    const unsubscribeB = billing.subscribe(vi.fn());
    await settle();
    expect(fixture.request).toHaveBeenCalledOnce();
    expect(billing.getSnapshot()).toBe(ready);
    expect(billing.has({ feature: 'reports' })).toBe(true);

    unsubscribeB();
    await settle();
    expect(billing.has({ feature: 'reports' })).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes sign-out during the deferred detach before a new subscriber arrives', async () => {
    const fixture = makeCore();
    const billing = createBillingClient(fixture.core);
    const unsubscribeA = billing.subscribe(vi.fn());
    await settle();
    expect(billing.has({ feature: 'reports' })).toBe(true);

    unsubscribeA();
    fixture.setSession(null, null);
    const unsubscribeB = billing.subscribe(vi.fn());
    expect(billing.getSnapshot().status).toBe('signed_out');
    expect(billing.has({ feature: 'reports' })).toBe(false);
    unsubscribeB();
    await settle();
  });

  it('detaches exactly one microtask after the last unsubscribe', async () => {
    const fixture = makeCore();
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.has({ feature: 'reports' })).toBe(true);

    unsubscribe();
    expect(billing.has({ feature: 'reports' })).toBe(true);
    await Promise.resolve();
    expect(billing.getSnapshot()).toBe(billing.getServerSnapshot());
    expect(billing.has({ feature: 'reports' })).toBe(false);
  });

  it('does not attach twice for a duplicate listener', () => {
    const fixture = makeCore();
    const listener = vi.fn();
    const first = createBillingClient(fixture.core).subscribe(listener);
    const second = createBillingClient(fixture.core).subscribe(listener);
    expect(fixture.sessionSubscribe).toHaveBeenCalledOnce();
    second();
    first();
  });

  it('posts check once without mutating the snapshot', async () => {
    const check = {
      feature: 'reports', allowed: true, kind: 'boolean', balance: null,
      reason: null, source: 'snapshot', subject: { type: 'user', id: USER_ID },
    };
    const fixture = makeCore({ replies: [ok(ALLOWED_LIST), ok(check)] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    const before = billing.getSnapshot();
    await expect(billing.check({ feature: 'reports' })).resolves.toMatchObject({ allowed: true });
    expect(fixture.request).toHaveBeenLastCalledWith(
      '/billing/check',
      expect.objectContaining({ method: 'POST', body: { feature: 'reports' } }),
    );
    expect(billing.getSnapshot()).toBe(before);
    unsubscribe();
  });

  it('preserves safe failure metadata on BillingRequestError', async () => {
    const fixture = makeCore({ replies: [
      ok(ALLOWED_LIST),
      {
        status: 503,
        retryAfterSeconds: 5,
        code: 'BILLING_UNAVAILABLE',
        requestId: 'request-5',
      },
    ] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    await expect(billing.check({ feature: 'reports' })).rejects.toMatchObject({
      name: 'BillingRequestError',
      status: 503,
      code: 'BILLING_UNAVAILABLE',
      requestId: 'request-5',
      retryAfterSeconds: 5,
    });
    unsubscribe();
  });

  it('preserves unknown entitlement kinds', async () => {
    const list = {
      ...ALLOWED_LIST,
      entitlements: [{ feature: 'seats', kind: 'future-kind', allowed: true, balance: 4 }],
    };
    const fixture = makeCore({ replies: [ok(list)] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.getSnapshot().entitlements[0]?.kind).toBe('future-kind');
    unsubscribe();
  });

  it('turns a malformed body into an empty error snapshot', async () => {
    const fixture = makeCore({ replies: [ok({ ...ALLOWED_LIST, entitlements: 'wrong' })] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.getSnapshot()).toMatchObject({ status: 'error', entitlements: [] });
    unsubscribe();
  });

  it('keeps no_customer distinct from not_granted', async () => {
    const noCustomer = { ...ALLOWED_LIST, status: 'no_customer' };
    const checks = [
      {
        feature: 'reports', allowed: false, kind: null, balance: null,
        reason: 'no_customer', source: 'none', subject: null,
      },
      {
        feature: 'reports', allowed: false, kind: null, balance: null,
        reason: 'not_granted', source: 'snapshot', subject: { type: 'user', id: USER_ID },
      },
    ];
    const fixture = makeCore({ replies: [ok(noCustomer), ...checks.map(ok)] });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    await settle();
    expect(billing.getSnapshot()).toMatchObject({ status: 'ready', reason: 'no_customer' });
    expect(billing.getSnapshot().entitlements).toHaveLength(1);
    expect(billing.has({ feature: 'reports' })).toBe(false);
    await expect(billing.check({ feature: 'reports' })).resolves.toMatchObject({ reason: 'no_customer' });
    await expect(billing.check({ feature: 'reports' })).resolves.toMatchObject({ reason: 'not_granted' });
    unsubscribe();
  });

  it('removes automatic work after the last unsubscribe', async () => {
    const pending = deferred<WireReply>();
    const fixture = makeCore({ handler: () => pending.promise });
    const billing = createBillingClient(fixture.core);
    const unsubscribe = billing.subscribe(vi.fn());
    const signal = fixture.request.mock.calls[0]![1].signal;
    unsubscribe();
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    fixture.setSession(USER_ID, ORG_ID);
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it('returns one constant signed-out server snapshot', () => {
    const billing = createBillingClient(makeCore().core);
    expect(billing.getServerSnapshot()).toBe(billing.getServerSnapshot());
    expect(billing.getServerSnapshot().status).toBe('signed_out');
  });
});
