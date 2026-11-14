import type { AuthOwlClient } from '@authowl/core';
import {
  createBillingStore,
  type BillingClient,
} from './store';

// Keep one cache when multiple copies load in one realm. Bump the key whenever
// BillingClient gains or changes a member.
const BILLING_CLIENTS = Symbol.for('authowl.billing.clients.v1');
type ClientRegistry = typeof globalThis & {
  [BILLING_CLIENTS]?: WeakMap<AuthOwlClient, BillingClient>;
};
const clientRegistry: ClientRegistry = globalThis;

/**
 * Return the same billing client for one core client, including across copies
 * of this package installed in the same JavaScript realm.
 */
export function createBillingClient(core: AuthOwlClient): BillingClient {
  const clients = (clientRegistry[BILLING_CLIENTS] ??= new WeakMap());
  const existing = clients.get(core);
  if (existing) return existing;
  const client = createBillingStore(core);
  clients.set(core, client);
  return client;
}

export {
  BILLING_SDK_POLICY,
  BillingRequestError,
  type BillingClient,
  type BillingSnapshot,
  type FeatureParams,
} from './store';
export type {
  BillingReason,
  EntitlementCheck,
  EntitlementStatus,
  EntitlementView,
} from './wire';
