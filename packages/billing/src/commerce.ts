import type {
  ClientExtension,
  ProjectJsonResult,
} from '@authowl/core';
import type { BillingRequestError } from './store';
import {
  decodeCheckoutResult,
  decodePortalResult,
  decodePricingCatalog,
  type CheckoutResult,
  type PortalResult,
  type PricingCatalog,
} from './wire';

export type CatalogSnapshot = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  catalog: PricingCatalog | null;
  error: BillingRequestError | null;
}>;

export type CheckoutParams = Readonly<{
  productId: string;
  currency: string;
  returnPath?: string;
}>;

export type PortalParams = Readonly<{ returnPath?: string }>;

export type CommerceClient = Readonly<{
  products(): Promise<PricingCatalog>;
  getCatalogSnapshot(): CatalogSnapshot;
  subscribeCatalog(listener: () => void): () => void;
  checkout(params: CheckoutParams): Promise<CheckoutResult>;
  portal(params?: PortalParams): Promise<PortalResult>;
}>;

type CommercePolicy = Readonly<{
  catalogStaleAfterMs: number;
  catalogMaxResponseBytes: number;
  maxResponseBytes: number;
  requestTimeoutMs: number;
  checkoutTimeoutMs: number;
  portalTimeoutMs: number;
  checkoutPendingRetries: number;
}>;

type CommerceDependencies = Readonly<{
  extension: ClientExtension;
  policy: CommercePolicy;
  requestError(result: Extract<ProjectJsonResult<unknown>, { ok: false }>): BillingRequestError;
  normalizeError(error: unknown): BillingRequestError;
}>;

const IDLE_CATALOG: CatalogSnapshot = Object.freeze({
  status: 'idle',
  catalog: null,
  error: null,
});

export function createCommerceClient(dependencies: CommerceDependencies): CommerceClient {
  const { extension, policy } = dependencies;
  const catalogListeners = new Set<() => void>();
  const checkoutRequests = new Map<string, Map<string, Promise<CheckoutResult>>>();
  let catalogSnapshot = IDLE_CATALOG;
  let catalogReceivedAt: number | null = null;
  let catalogRequest: Promise<PricingCatalog> | null = null;

  function publishCatalog(snapshot: CatalogSnapshot): void {
    catalogSnapshot = Object.freeze(snapshot);
    for (const listener of catalogListeners) listener();
  }

  function products(): Promise<PricingCatalog> {
    if (catalogSnapshot.catalog && catalogReceivedAt !== null
      && Date.now() - catalogReceivedAt < policy.catalogStaleAfterMs) {
      return Promise.resolve(catalogSnapshot.catalog);
    }
    if (catalogRequest) return catalogRequest;
    publishCatalog({
      status: 'loading',
      catalog: catalogSnapshot.catalog,
      error: null,
    });
    const request = requestCatalog().then((catalog) => {
      catalogReceivedAt = Date.now();
      publishCatalog({ status: 'ready', catalog, error: null });
      return catalog;
    }).catch((error: unknown) => {
      const normalized = dependencies.normalizeError(error);
      publishCatalog({
        status: 'error',
        catalog: catalogSnapshot.catalog,
        error: normalized,
      });
      throw normalized;
    }).finally(() => {
      if (catalogRequest === request) catalogRequest = null;
    });
    catalogRequest = request;
    return request;
  }

  async function requestCatalog(): Promise<PricingCatalog> {
    const result = await extension.requestProjectJson('/billing/products', {
      method: 'GET',
      timeoutMs: policy.requestTimeoutMs,
      maxResponseBytes: policy.catalogMaxResponseBytes,
      decode: decodePricingCatalog,
    });
    if (!result.ok) throw dependencies.requestError(result);
    return result.data;
  }

  function checkout(params: CheckoutParams): Promise<CheckoutResult> {
    let currencies = checkoutRequests.get(params.productId);
    if (!currencies) {
      currencies = new Map();
      checkoutRequests.set(params.productId, currencies);
    }
    const existing = currencies.get(params.currency);
    if (existing) return existing;
    const body = params.returnPath === undefined
      ? { productId: params.productId, currency: params.currency }
      : {
        productId: params.productId,
        currency: params.currency,
        returnPath: params.returnPath,
      };
    const request = runCheckout(body).catch((error: unknown) => {
      throw dependencies.normalizeError(error);
    }).finally(() => {
      const active = checkoutRequests.get(params.productId);
      if (active?.get(params.currency) !== request) return;
      active.delete(params.currency);
      if (active.size === 0) checkoutRequests.delete(params.productId);
    });
    currencies.set(params.currency, request);
    return request;
  }

  async function runCheckout(body: Readonly<{
    productId: string;
    currency: string;
    returnPath?: string;
  }>): Promise<CheckoutResult> {
    for (let retry = 0; ; retry += 1) {
      const result = await extension.requestProjectJson('/billing/checkout', {
        method: 'POST',
        body,
        timeoutMs: policy.checkoutTimeoutMs,
        maxResponseBytes: policy.maxResponseBytes,
        decode: decodeCheckoutResult,
      });
      if (!result.ok) throw dependencies.requestError(result);
      if (result.data.status !== 'pending') return result.data;
      if (retry >= policy.checkoutPendingRetries) {
        return Object.freeze({ status: 'pending' });
      }
      await wait(result.data.retryAfterSeconds! * 1000);
    }
  }

  async function portal(params: PortalParams = {}): Promise<PortalResult> {
    const body = params.returnPath === undefined ? {} : { returnPath: params.returnPath };
    try {
      const result = await extension.requestProjectJson('/billing/portal', {
        method: 'POST',
        body,
        timeoutMs: policy.portalTimeoutMs,
        maxResponseBytes: policy.maxResponseBytes,
        decode: decodePortalResult,
      });
      if (!result.ok) throw dependencies.requestError(result);
      return result.data;
    } catch (error) {
      throw dependencies.normalizeError(error);
    }
  }

  return Object.freeze({
    products,
    getCatalogSnapshot: () => catalogSnapshot,
    subscribeCatalog(listener: () => void) {
      catalogListeners.add(listener);
      return () => catalogListeners.delete(listener);
    },
    checkout,
    portal,
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
