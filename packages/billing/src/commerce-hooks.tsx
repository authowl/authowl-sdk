'use client';
import * as React from 'react';
import { useAuth, useAuthClient } from '@authowl/react';
import {
  BILLING_SDK_POLICY,
  createBillingClient,
  normalizeBillingError,
  type BillingClient,
} from './index';
import type { BillingSubscription, CheckoutResult, PortalResult, PricingCatalog, PricingProduct } from './wire';

const CHECKOUT_MARKER_KEY = 'authowl.billing.checkout.v1';
const NON_LIVE_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete', 'incomplete_expired']);

export function activeSubscription(subscription: BillingSubscription | null): BillingSubscription | null {
  return subscription && !NON_LIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
    ? subscription
    : null;
}

export function useBillingClient(): BillingClient {
  return createBillingClient(useAuthClient());
}

export type UsePricingResult = Readonly<{
  status: 'loading' | 'ready' | 'empty' | 'not_connected' | 'error';
  products: readonly PricingProduct[];
  currency: string | null;
  currencies: readonly string[];
  setCurrency(currency: string): void;
  environment: PricingCatalog['environment'] | null;
  customerType: PricingCatalog['customerType'] | null;
  provider: string | null;
  error: ReturnType<BillingClient['getSnapshot']>['error'];
  refresh(): Promise<void>;
}>;

export function usePricing(options: Readonly<{ currency?: string }> = {}): UsePricingResult {
  const client = useBillingClient();
  const snapshot = React.useSyncExternalStore(
    client.subscribeCatalog,
    client.getCatalogSnapshot,
    client.getCatalogSnapshot,
  );
  const [chosenCurrency, setChosenCurrency] = React.useState<string | null>(null);
  React.useEffect(() => {
    void client.products().catch(() => undefined);
  }, [client]);
  const catalog = snapshot.catalog;
  const currency = options.currency ?? chosenCurrency ?? catalog?.defaultCurrency ?? null;
  const products = React.useMemo(() => {
    if (!catalog || !currency) return [];
    return catalog.products.flatMap((product) => {
      const price = product.prices.find((candidate) => candidate.currency === currency);
      return price ? [{ ...product, prices: Object.freeze([price]) }] : [];
    }).sort((a, b) => a.prices[0]!.amount - b.prices[0]!.amount
      || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [catalog, currency]);
  let status: UsePricingResult['status'];
  if (catalog?.status === 'not_connected') status = 'not_connected';
  else if (catalog) status = products.length === 0 ? 'empty' : 'ready';
  else status = snapshot.status === 'error' ? 'error' : 'loading';
  const refresh = React.useCallback(async () => {
    await client.products();
  }, [client]);
  return React.useMemo(() => ({
    status,
    products,
    currency,
    currencies: catalog?.currencies ?? [],
    setCurrency: setChosenCurrency,
    environment: catalog?.environment ?? null,
    customerType: catalog?.customerType ?? null,
    provider: currency ? catalog?.providers[currency] ?? null : null,
    error: snapshot.error,
    refresh,
  }), [catalog, currency, products, refresh, snapshot.error, status]);
}

export type CheckoutHookResult = Exclude<CheckoutResult, { status: 'redirect' }>
  | Readonly<{
    status: 'redirect';
    productId: string;
    currency: string;
    expiresAt: string;
  }>;
export type CheckoutHookStatus = 'idle' | 'pending' | 'redirecting' | 'slow' | 'error'
  | CheckoutHookResult['status'];
export type UseCheckoutResult = Readonly<{
  start(params: Readonly<{
    productId: string;
    currency: string;
    returnPath?: string;
  }>): Promise<CheckoutHookResult | null>;
  status: CheckoutHookStatus;
  result: CheckoutHookResult | null;
  error: ReturnType<BillingClient['getSnapshot']>['error'];
  reset(): void;
}>;

function withoutCheckoutUrl(result: CheckoutResult): CheckoutHookResult {
  if (result.status !== 'redirect') return result;
  return {
    status: result.status,
    productId: result.productId,
    currency: result.currency,
    expiresAt: result.expiresAt,
  };
}

function writeCheckoutMarker(input: Readonly<{
  productId: string;
  currency: string;
  userId: string;
}>): void {
  try {
    sessionStorage.setItem(CHECKOUT_MARKER_KEY, JSON.stringify({ ...input, startedAt: Date.now() }));
  } catch {
    /* Storage is optional. */
  }
}

function navigateToHostedPage(url: string): void {
  window.location.assign(url);
}

function useResetOnBfcacheRestore(reset: () => void): void {
  React.useEffect(() => {
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener('pageshow', pageshow);
    return () => window.removeEventListener('pageshow', pageshow);
  }, [reset]);
}

export function useCheckout(): UseCheckoutResult {
  const client = useBillingClient();
  const { userId } = useAuth();
  const [status, setStatus] = React.useState<CheckoutHookStatus>('idle');
  const [result, setResult] = React.useState<CheckoutHookResult | null>(null);
  const [error, setError] = React.useState<ReturnType<BillingClient['getSnapshot']>['error']>(null);
  const active = React.useRef<Readonly<{
    key: string;
    request: Promise<CheckoutHookResult | null>;
  }> | null>(null);
  const reset = React.useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);
  useResetOnBfcacheRestore(reset);
  const start = React.useCallback((params: Readonly<{
    productId: string; currency: string; returnPath?: string;
  }>) => {
    const key = `${params.productId}\u0000${params.currency}`;
    if (active.current?.key === key) return active.current.request;
    setStatus('pending');
    setError(null);
    const request = client.checkout(params).then((next) => {
      const publicResult = withoutCheckoutUrl(next);
      setResult(publicResult);
      if (next.status === 'redirect') {
        if (userId) writeCheckoutMarker({ productId: next.productId, currency: next.currency, userId });
        setStatus('redirecting');
        navigateToHostedPage(next.url);
      } else {
        setStatus(next.status === 'pending' ? 'slow' : next.status);
        if (next.status === 'active') void client.refresh().catch(() => undefined);
      }
      return publicResult;
    }).catch((cause: unknown) => {
      setError(normalizeBillingError(cause));
      setStatus('error');
      return null;
    }).finally(() => {
      if (active.current?.request === request) active.current = null;
    });
    active.current = { key, request };
    return request;
  }, [client, userId]);
  return React.useMemo(() => ({ start, status, result, error, reset }), [error, reset, result, start, status]);
}

export type CheckoutReturnStatus = 'none' | 'confirming' | 'confirmed' | 'unconfirmed';
type CheckoutMarker = Readonly<{
  productId: string; currency: string; userId: string; startedAt: number;
}>;

function readCheckoutMarker(): CheckoutMarker | null {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_MARKER_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.productId !== 'string' || typeof row.currency !== 'string'
      || typeof row.userId !== 'string' || typeof row.startedAt !== 'number') return null;
    return row as CheckoutMarker;
  } catch {
    return null;
  }
}

function removeCheckoutMarker(): void {
  try {
    sessionStorage.removeItem(CHECKOUT_MARKER_KEY);
  } catch {
    /* Storage is optional. */
  }
}

export function useCheckoutReturn(options: Readonly<{
  onComplete?(productId: string): void;
}> = {}): Readonly<{
  status: CheckoutReturnStatus;
  productId: string | null;
  dismiss(): void;
}> {
  const client = useBillingClient();
  const { isLoaded, userId } = useAuth();
  const [state, setState] = React.useState<Readonly<{
    status: CheckoutReturnStatus; productId: string | null;
  }>>({ status: 'none', productId: null });
  const onComplete = React.useRef(options.onComplete);
  onComplete.current = options.onComplete;
  React.useEffect(() => {
    if (!isLoaded) return;
    const marker = readCheckoutMarker();
    if (!marker) return;
    if (!userId || marker.userId !== userId || Date.now() - marker.startedAt < 0
      || Date.now() - marker.startedAt > BILLING_SDK_POLICY.returnMarkerTtlMs) {
      removeCheckoutMarker();
      return;
    }
    let cancelled = false;
    const unsubscribe = client.subscribe(() => undefined);
    setState({ status: 'confirming', productId: marker.productId });
    void (async () => {
      for (const delay of BILLING_SDK_POLICY.returnPollScheduleMs) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled) return;
        try {
          await client.refresh();
        } catch {
          continue;
        }
        const subscription = activeSubscription(client.getSnapshot().subscription);
        if (subscription?.productId === marker.productId) {
          removeCheckoutMarker();
          setState({ status: 'confirmed', productId: marker.productId });
          onComplete.current?.(marker.productId);
          return;
        }
      }
      if (!cancelled) setState({ status: 'unconfirmed', productId: marker.productId });
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, isLoaded, userId]);
  const dismiss = React.useCallback(() => {
    removeCheckoutMarker();
    setState({ status: 'none', productId: null });
  }, []);
  return React.useMemo(() => ({ ...state, dismiss }), [dismiss, state]);
}

export type PortalHookResult = Exclude<PortalResult, { status: 'redirect' }>
  | Readonly<{ status: 'redirect'; expiresAt: string }>;
export type PortalHookStatus = 'idle' | 'pending' | 'redirecting' | 'error' | PortalHookResult['status'];
export function useCustomerPortal(): Readonly<{
  open(params?: Readonly<{ returnPath?: string }>): Promise<PortalHookResult | null>;
  status: PortalHookStatus;
  error: ReturnType<BillingClient['getSnapshot']>['error'];
}> {
  const client = useBillingClient();
  const [status, setStatus] = React.useState<PortalHookStatus>('idle');
  const [error, setError] = React.useState<ReturnType<BillingClient['getSnapshot']>['error']>(null);
  const reset = React.useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);
  useResetOnBfcacheRestore(reset);
  const open = React.useCallback(async (params?: Readonly<{ returnPath?: string }>) => {
    setStatus('pending');
    setError(null);
    try {
      const result = await client.portal(params);
      if (result.status === 'redirect') {
        const publicResult = { status: result.status, expiresAt: result.expiresAt } as const;
        setStatus('redirecting');
        navigateToHostedPage(result.url);
        return publicResult;
      }
      setStatus(result.status);
      return result;
    } catch (cause) {
      setError(normalizeBillingError(cause));
      setStatus('error');
      return null;
    }
  }, [client]);
  return React.useMemo(() => ({ open, status, error }), [error, open, status]);
}

export function safeReturnPath(value: string | undefined): string {
  const path = value ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  if (path.length < 1 || path.length > 512 || !/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/.test(path)
    || path.includes('//') || /(?:\/\.\.\/|\/\.\.$|%2f|%5c|%00|%25)/i.test(path)) return '/';
  try {
    const resolved = new URL(path, 'https://return.invalid');
    return resolved.pathname === path ? path : '/';
  } catch {
    return '/';
  }
}
