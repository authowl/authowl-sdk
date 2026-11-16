import type { AuthOwlClient } from '@authowl/core';
import { createBillingStore, type EntitlementClient } from './store';

const ENTITLEMENT_CLIENTS = Symbol.for('authowl.billing.entitlement-clients.v1');
type EntitlementRegistry = typeof globalThis & {
  [ENTITLEMENT_CLIENTS]?: WeakMap<AuthOwlClient, EntitlementClient>;
};
const entitlementRegistry: EntitlementRegistry = globalThis;

export function createEntitlementClient(core: AuthOwlClient): EntitlementClient {
  const clients = (entitlementRegistry[ENTITLEMENT_CLIENTS] ??= new WeakMap());
  const existing = clients.get(core);
  if (existing) return existing;
  const client = createBillingStore(core);
  clients.set(core, client);
  return client;
}
