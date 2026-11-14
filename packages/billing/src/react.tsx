'use client';
import * as React from 'react';
import { useAuthClient } from '@authowl/react';
import {
  createBillingClient,
  type BillingClient,
  type BillingRequestError,
  type BillingSnapshot,
  type FeatureParams,
} from './index';
import { hasEntitlement, isFreshSnapshot } from './store';
import type { EntitlementCheck, EntitlementView } from './wire';

export function useBillingClient(): BillingClient {
  return createBillingClient(useAuthClient());
}

export type UseEntitlementsResult = Readonly<{
  entitlements: readonly EntitlementView[];
  has(params: FeatureParams): boolean;
  isLoading: boolean;
  isStale: boolean;
  reason: BillingSnapshot['reason'];
  error: BillingRequestError | null;
  refresh(): Promise<void>;
  check(params: FeatureParams): Promise<EntitlementCheck>;
}>;

/**
 * Read the current entitlement snapshot. `has` is only a UI hint for metered
 * features; use `check()` when the server must answer with current state.
 */
export function useEntitlements(): UseEntitlementsResult {
  const client = useBillingClient();
  const snapshot = React.useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getServerSnapshot,
  );
  const [mounted, setMounted] = React.useState(snapshot.status !== 'signed_out');
  React.useEffect(() => setMounted(true), []);
  const isStale = snapshot.status === 'ready' && !isFreshSnapshot(snapshot, Date.now());
  return React.useMemo(() => ({
    entitlements: snapshot.entitlements,
    has: (params: FeatureParams) => mounted
      && hasEntitlement(snapshot, params.feature, Date.now()),
    isLoading: !mounted || snapshot.status === 'loading',
    isStale,
    reason: snapshot.reason,
    error: snapshot.error,
    refresh: client.refresh,
    check: client.check,
  }), [client, isStale, mounted, snapshot]);
}

export type ProtectProps = Readonly<{
  feature: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}>;

/**
 * Advisory UI only. Enforce access with a server-side entitlement check or the
 * Admin API check. The fallback renders while loading, on error, when stale,
 * signed out, for every reason, and when denied. `@authowl/react`'s `Protect`
 * gates roles and permissions, so alias one import when both are used.
 */
export function Protect({
  feature,
  fallback = null,
  children,
}: ProtectProps): React.JSX.Element {
  const { has } = useEntitlements();
  return <>{has({ feature }) ? children : fallback}</>;
}
