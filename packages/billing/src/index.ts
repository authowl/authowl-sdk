import { clientExtension, type AuthOwlClient } from '@authowl/core';
import { createCommerceClient, type CommerceClient } from './commerce';
import { createEntitlementClient } from './entitlement-client';
import {
  BILLING_SDK_POLICY,
  BillingRequestError,
  requestError,
  type EntitlementClient,
} from './store';

export type BillingClient = EntitlementClient & CommerceClient;

// Keep one cache when multiple copies load in one realm. Bump the key whenever
// BillingClient gains or changes a member.
const BILLING_CLIENTS = Symbol.for('authowl.billing.clients.v2');
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
  const entitlements = createEntitlementClient(core);
  const commerce = createCommerceClient({
    extension: clientExtension(core),
    policy: BILLING_SDK_POLICY,
    requestError,
    normalizeError(error) {
      return error instanceof BillingRequestError
        ? error
        : new BillingRequestError({ status: null });
    },
  });
  const client: BillingClient = Object.freeze({ ...entitlements, ...commerce });
  clients.set(core, client);
  return client;
}

export {
  BILLING_SDK_POLICY,
  BillingRequestError,
  type BillingSnapshot,
  type EntitlementClient,
  type FeatureParams,
} from './store';
export type {
  CatalogSnapshot,
  CheckoutParams,
  CommerceClient,
  PortalParams,
} from './commerce';
export type {
  BillingSubscription,
  BillingReason,
  CheckoutResult,
  EntitlementCheck,
  EntitlementStatus,
  EntitlementView,
  PortalResult,
  PricingCatalog,
  PricingFeature,
  PricingPrice,
  PricingProduct,
} from './wire';
