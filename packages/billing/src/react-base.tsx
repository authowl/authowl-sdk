'use client';
import * as React from 'react';
import { useAuthClient } from '@authowl/react';
import type { BillingRequestError, BillingSnapshot, FeatureParams } from './index';
import { createEntitlementClient } from './entitlement-client';
import { hasEntitlement, isFreshSnapshot } from './store';
import type { EntitlementCheck, EntitlementView } from './wire';

export type UseEntitlementsResult = Readonly<{
  entitlements: readonly EntitlementView[];
  subscription: BillingSnapshot['subscription'];
  canManage: boolean;
  has(params: FeatureParams): boolean;
  isLoading: boolean;
  isStale: boolean;
  reason: BillingSnapshot['reason'];
  error: BillingRequestError | null;
  refresh(): Promise<void>;
  check(params: FeatureParams): Promise<EntitlementCheck>;
}>;

/** Return the cached entitlement client used by the lightweight React entry. */
export function useBillingClient() {
  return createEntitlementClient(useAuthClient());
}

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
    subscription: snapshot.subscription,
    canManage: snapshot.canManage,
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

export function Protect({
  feature,
  fallback = null,
  children,
}: ProtectProps): React.JSX.Element {
  const { has } = useEntitlements();
  return <>{has({ feature }) ? children : fallback}</>;
}
