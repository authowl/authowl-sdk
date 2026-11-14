import {
  clientExtension,
  type AuthOwlClient,
  type ProjectJsonResult,
  type SessionState,
} from '@authowl/core';
import {
  decodeEntitlementCheck,
  decodeEntitlementList,
  type EntitlementCheck,
  type EntitlementStatus,
  type EntitlementView,
} from './wire';

export const BILLING_SDK_POLICY = Object.freeze({
  staleAfterMs: 60_000,
  refreshIntervalMs: 45_000,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 128 * 1_024,
  backoffMs: Object.freeze([2_000, 10_000, 30_000, 60_000] as const),
});

export type BillingSnapshot = Readonly<{
  status: 'signed_out' | 'loading' | 'ready' | 'error';
  stale: boolean;
  reason: EntitlementStatus | null;
  entitlements: readonly EntitlementView[];
  receivedAt: number | null;
  error: BillingRequestError | null;
}>;

const REQUEST_ERROR_BRAND = Symbol.for('authowl.billing.request-error.v1');

export class BillingRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === 'object' && value !== null && REQUEST_ERROR_BRAND in value;
  }

  constructor(input: Readonly<{
    status: number | null;
    code?: string | null;
    requestId?: string | null;
    retryAfterSeconds?: number | null;
  }>) {
    super(input.status === null
      ? 'The billing request could not be completed.'
      : `The billing request failed with status ${input.status}.`);
    this.name = 'BillingRequestError';
    this.status = input.status;
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    Object.defineProperty(this, REQUEST_ERROR_BRAND, { value: true });
  }
}

export type FeatureParams = Readonly<{ feature: string }>;

export type BillingClient = Readonly<{
  has(params: FeatureParams): boolean;
  getSnapshot(): BillingSnapshot;
  getServerSnapshot(): BillingSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  check(params: FeatureParams): Promise<EntitlementCheck>;
}>;

const EMPTY_ENTITLEMENTS = Object.freeze([]) as readonly EntitlementView[];
const EMPTY = Object.freeze({
  stale: false,
  reason: null,
  entitlements: EMPTY_ENTITLEMENTS,
  receivedAt: null,
  error: null,
});
const SIGNED_OUT_SNAPSHOT = snapshot({ ...EMPTY, status: 'signed_out' });
const LOADING_SNAPSHOT = snapshot({ ...EMPTY, status: 'loading' });

type ActiveRequest = {
  controller: AbortController;
  promise: Promise<void>;
};

type QueuedRefresh = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export function createBillingStore(core: AuthOwlClient): BillingClient {
  const extension = clientExtension(core);
  const listeners = new Set<() => void>();
  let current = SIGNED_OUT_SNAPSHOT;
  let identity: string | null = null;
  let sessionUnsubscribe: (() => void) | null = null;
  let detachBrowserListeners: (() => void) | null = null;
  let active: ActiveRequest | null = null;
  let queued: QueuedRefresh | null = null;
  let retryIndex = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let pendingDetach: object | null = null;

  function publish(next: BillingSnapshot): void {
    if (sameSnapshot(current, next)) return;
    current = next;
    scheduleStaleTimer();
    for (const listener of listeners) listener();
  }

  function has({ feature }: FeatureParams): boolean {
    return hasEntitlement(current, feature, Date.now());
  }

  function readIdentity(state: SessionState): string | null {
    if (!state.data) return null;
    return `${state.data.user.id}\u0000${state.data.session.activeOrganizationId ?? ''}`;
  }

  function syncIdentity(): void {
    const state = core.sessionStore.getSnapshot();
    if (!state.data) {
      resetIdentity();
      if (state.isPending) publish(LOADING_SNAPSHOT);
      else if (state.error) publish(errorSnapshot(new BillingRequestError({ status: null })));
      else publish(SIGNED_OUT_SNAPSHOT);
      return;
    }
    if (state.data.session.pendingMfaEnrollment === true) {
      resetIdentity();
      publish(SIGNED_OUT_SNAPSHOT);
      return;
    }
    const nextIdentity = readIdentity(state);
    if (nextIdentity === identity) return;
    resetIdentity();
    identity = nextIdentity;
    publish(LOADING_SNAPSHOT);
    void refreshIdle();
  }

  function resetIdentity(): void {
    if (identity === null && active === null && retryTimer === null && queued === null) return;
    identity = null;
    retryIndex = 0;
    clearRetryTimer();
    active?.controller.abort();
    active = null;
    queued?.resolve();
    queued = null;
  }

  function startRequest(): Promise<void> {
    const controller = new AbortController();
    const request = {} as ActiveRequest;
    request.controller = controller;
    request.promise = runRefresh(request).finally(() => finishRequest(request));
    active = request;
    return request.promise;
  }

  function finishRequest(request: ActiveRequest): void {
    if (!isCurrent(request)) return;
    active = null;
    const waiting = queued;
    if (!waiting) return;
    queued = null;
    if (retryTimer !== null) {
      waiting.resolve();
      return;
    }
    startRequest().then(waiting.resolve, waiting.reject);
  }

  function refreshIdle(): Promise<void> {
    if (typeof window === 'undefined' || listeners.size === 0 || identity === null) {
      return Promise.resolve();
    }
    if (retryTimer !== null) return Promise.resolve();
    return active?.promise ?? startRequest();
  }

  function refresh(): Promise<void> {
    if (typeof window === 'undefined' || listeners.size === 0 || identity === null) {
      return Promise.resolve();
    }
    if (retryTimer !== null) return Promise.resolve();
    if (!active) return startRequest();
    queued ??= deferredRefresh();
    return queued.promise;
  }

  async function runRefresh(request: ActiveRequest): Promise<void> {
    try {
      const result = await extension.requestProjectJson('/billing/entitlements', {
        method: 'GET',
        timeoutMs: BILLING_SDK_POLICY.requestTimeoutMs,
        maxResponseBytes: BILLING_SDK_POLICY.maxResponseBytes,
        decode: decodeEntitlementList,
        signal: request.controller.signal,
      });
      if (!isCurrent(request)) return;
      if (!result.ok && result.status === 401) {
        publish(SIGNED_OUT_SNAPSHOT);
        return;
      }
      if (!result.ok) {
        failRequest(requestError(result));
        return;
      }
      retryIndex = 0;
      publish(snapshot({
        status: 'ready',
        stale: false,
        reason: result.data.status,
        entitlements: result.data.entitlements,
        receivedAt: Date.now(),
        error: null,
      }));
    } catch {
      if (!isCurrent(request) || request.controller.signal.aborted) return;
      failRequest(new BillingRequestError({ status: null }));
    }
  }

  function failRequest(error: BillingRequestError): void {
    publish(errorSnapshot(error));
    clearRetryTimer();
    const policyDelay = BILLING_SDK_POLICY.backoffMs[
      Math.min(retryIndex, BILLING_SDK_POLICY.backoffMs.length - 1)
    ]!;
    retryIndex = Math.min(retryIndex + 1, BILLING_SDK_POLICY.backoffMs.length - 1);
    const delay = error.retryAfterSeconds !== null
      && (error.status === 429 || error.status === 503)
      ? Math.min(
        error.retryAfterSeconds * 1000,
        BILLING_SDK_POLICY.backoffMs[BILLING_SDK_POLICY.backoffMs.length - 1]!,
      )
      : policyDelay;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void refreshIdle();
    }, delay);
  }

  function isCurrent(request: ActiveRequest): boolean {
    return active === request;
  }

  function scheduleStaleTimer(): void {
    if (staleTimer !== null) clearTimeout(staleTimer);
    staleTimer = null;
    if (typeof window === 'undefined' || listeners.size === 0
      || current.status !== 'ready' || current.receivedAt === null || current.stale) {
      return;
    }
    const receivedAt = current.receivedAt;
    const delay = Math.max(0, receivedAt + BILLING_SDK_POLICY.staleAfterMs - Date.now());
    staleTimer = setTimeout(() => {
      staleTimer = null;
      if (current.status !== 'ready' || current.receivedAt !== receivedAt || current.stale) return;
      publish(snapshot({ ...current, stale: true }));
    }, delay);
  }

  function startVisibleInterval(): void {
    if (refreshInterval !== null || document.visibilityState !== 'visible') return;
    refreshInterval = setInterval(() => {
      void refreshIdle();
    }, BILLING_SDK_POLICY.refreshIntervalMs);
  }

  function stopVisibleInterval(): void {
    if (refreshInterval !== null) clearInterval(refreshInterval);
    refreshInterval = null;
  }

  function clearRetryTimer(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function attach(): void {
    sessionUnsubscribe = core.sessionStore.subscribe(syncIdentity);
    const refreshOnIdle = () => void refreshIdle();
    const visibility = () => {
      if (document.visibilityState === 'visible') {
        startVisibleInterval();
        void refreshIdle();
      } else {
        stopVisibleInterval();
      }
    };
    window.addEventListener('focus', refreshOnIdle);
    window.addEventListener('online', refreshOnIdle);
    document.addEventListener('visibilitychange', visibility);
    detachBrowserListeners = () => {
      window.removeEventListener('focus', refreshOnIdle);
      window.removeEventListener('online', refreshOnIdle);
      document.removeEventListener('visibilitychange', visibility);
    };
    startVisibleInterval();
    syncIdentity();
  }

  function detach(): void {
    sessionUnsubscribe?.();
    sessionUnsubscribe = null;
    detachBrowserListeners?.();
    detachBrowserListeners = null;
    active?.controller.abort();
    active = null;
    identity = null;
    queued?.resolve();
    queued = null;
    retryIndex = 0;
    clearRetryTimer();
    if (staleTimer !== null) clearTimeout(staleTimer);
    staleTimer = null;
    stopVisibleInterval();
    current = SIGNED_OUT_SNAPSHOT;
  }

  function scheduleDetach(): void {
    const pending = {};
    pendingDetach = pending;
    // Keep the store attached across a synchronous route swap so it neither
    // flashes the fallback nor refetches. A real gap still resets fail closed.
    void Promise.resolve().then(() => {
      if (pendingDetach !== pending) return;
      pendingDetach = null;
      if (listeners.size === 0) detach();
    });
  }

  async function check({ feature }: FeatureParams): Promise<EntitlementCheck> {
    try {
      const result = await extension.requestProjectJson('/billing/check', {
        method: 'POST',
        body: { feature },
        timeoutMs: BILLING_SDK_POLICY.requestTimeoutMs,
        maxResponseBytes: BILLING_SDK_POLICY.maxResponseBytes,
        decode: decodeEntitlementCheck,
      });
      if (!result.ok) throw requestError(result);
      return result.data;
    } catch (error) {
      if (error instanceof BillingRequestError) throw error;
      throw new BillingRequestError({ status: null });
    }
  }

  return Object.freeze({
    has,
    getSnapshot: () => current,
    getServerSnapshot: () => SIGNED_OUT_SNAPSHOT,
    subscribe(listener: () => void) {
      pendingDetach = null;
      listeners.add(listener);
      if (listeners.size === 1 && sessionUnsubscribe === null && typeof window !== 'undefined') {
        attach();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) scheduleDetach();
      };
    },
    refresh,
    check,
  });
}

export function hasEntitlement(
  value: BillingSnapshot,
  feature: string,
  now: number,
): boolean {
  return isFreshSnapshot(value, now)
    && value.reason === 'ok'
    && value.entitlements.some((row) => row.feature === feature && row.allowed);
}

export function isFreshSnapshot(value: BillingSnapshot, now: number): boolean {
  return value.status === 'ready'
    && !value.stale
    && value.receivedAt !== null
    && now >= value.receivedAt
    && now - value.receivedAt < BILLING_SDK_POLICY.staleAfterMs;
}

function snapshot(value: BillingSnapshot): BillingSnapshot {
  return Object.freeze(value);
}

function errorSnapshot(error: BillingRequestError): BillingSnapshot {
  return snapshot({ ...EMPTY, status: 'error', error });
}

function requestError(result: Extract<ProjectJsonResult<unknown>, { ok: false }>): BillingRequestError {
  return new BillingRequestError({
    status: result.status,
    code: result.code,
    requestId: result.requestId,
    retryAfterSeconds: result.retryAfterSeconds,
  });
}

function deferredRefresh(): QueuedRefresh {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Every successful refresh replaces its ready snapshot and notifies listeners.
function sameSnapshot(left: BillingSnapshot, right: BillingSnapshot): boolean {
  return left === right
    || (left.status === 'error' && right.status === 'error' && sameError(left.error, right.error));
}

function sameError(
  left: BillingRequestError | null,
  right: BillingRequestError | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.status === right.status
    && left.code === right.code
    && left.requestId === right.requestId
    && left.retryAfterSeconds === right.retryAfterSeconds;
}
