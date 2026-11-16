'use client';
import * as React from 'react';
import {
  slot,
  useAuth,
  useAuthClient,
  useAuthOwlContext,
  useLocale,
} from '@authowl/react';
import {
  BILLING_SDK_POLICY,
  BillingRequestError,
  createBillingClient,
  type BillingClient,
} from './index';
import { billingMessage, type BillingLocale, type BillingMessageKey } from './i18n';
import { formatCount, formatPrice } from './money';
import { useEntitlements } from './react-base';
import type {
  CheckoutResult,
  PortalResult,
  PricingCatalog,
  PricingProduct,
} from './wire';

export { Protect, useEntitlements } from './react-base';
export type { ProtectProps, UseEntitlementsResult } from './react-base';

export function useBillingClient(): BillingClient {
  return createBillingClient(useAuthClient());
}

export type BillingElementSlot =
  | 'pricing-table' | 'pricing-toolbar' | 'pricing-currency' | 'pricing-grid'
  | 'pricing-card' | 'pricing-card-highlighted' | 'pricing-badge' | 'pricing-name'
  | 'pricing-price' | 'pricing-amount' | 'pricing-interval' | 'pricing-features'
  | 'pricing-feature' | 'pricing-cta' | 'pricing-note' | 'pricing-disclosure'
  | 'pricing-status' | 'pricing-test-mode' | 'checkout-button' | 'checkout-error'
  | 'portal-link';

export type BillingElements = Partial<Record<BillingElementSlot, string>>;
export type BillingAppearance = Readonly<{ elements?: BillingElements }>;

const CHECKOUT_MARKER_KEY = 'authowl.billing.checkout.v1';
const PROVIDERS: Readonly<Record<string, string>> = Object.freeze({ paymob: 'Paymob', stripe: 'Stripe' });
const UNCONFIRMED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete', 'incomplete_expired']);

function useBillingText(): (key: BillingMessageKey, values?: Record<string, string | number>) => string {
  const locale = useLocale() as BillingLocale;
  return React.useCallback(
    (key, values) => billingMessage(locale, key, values),
    [locale],
  );
}

function billingSlot(name: BillingElementSlot, appearance?: BillingAppearance): string {
  const extra = appearance?.elements?.[name];
  return `ao-${name} ba-${name}${extra ? ` ${extra}` : ''}`;
}

function useSharedSlots(): (name: Parameters<typeof slot>[0]) => string {
  const elements = useAuthOwlContext().appearance?.elements;
  return React.useCallback((name) => slot(name, elements), [elements]);
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
  error: BillingRequestError | null;
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
  let status: UsePricingResult['status'] = 'loading';
  if (snapshot.status === 'error') status = 'error';
  else if (catalog?.status === 'not_connected') status = 'not_connected';
  else if (snapshot.status === 'ready') status = products.length === 0 ? 'empty' : 'ready';
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

type CheckoutHookStatus = 'idle' | 'pending' | 'redirecting' | 'error' | CheckoutResult['status'];
export type UseCheckoutResult = Readonly<{
  start(params: Readonly<{ productId: string; currency: string; returnPath?: string }>): Promise<CheckoutResult | null>;
  status: CheckoutHookStatus;
  result: CheckoutResult | null;
  error: BillingRequestError | null;
  reset(): void;
}>;

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
  const previewNavigate = process.env.NODE_ENV !== 'production'
    ? (globalThis as typeof globalThis & {
      __AUTHOWL_BILLING_PREVIEW_NAVIGATE__?: (target: string) => void;
    }).__AUTHOWL_BILLING_PREVIEW_NAVIGATE__
    : undefined;
  if (previewNavigate) previewNavigate(url);
  else window.location.assign(url);
}

export function useCheckout(): UseCheckoutResult {
  const client = useBillingClient();
  const { userId } = useAuth();
  const [status, setStatus] = React.useState<CheckoutHookStatus>('idle');
  const [result, setResult] = React.useState<CheckoutResult | null>(null);
  const [error, setError] = React.useState<BillingRequestError | null>(null);
  const active = React.useRef<Promise<CheckoutResult | null> | null>(null);
  const start = React.useCallback((params: Readonly<{
    productId: string; currency: string; returnPath?: string;
  }>) => {
    if (active.current) return active.current;
    setStatus('pending');
    setError(null);
    const request = client.checkout(params).then(async (next) => {
      setResult(next);
      if (next.status === 'redirect') {
        if (userId) writeCheckoutMarker({ productId: next.productId, currency: next.currency, userId });
        setStatus('redirecting');
        navigateToHostedPage(next.url);
      } else {
        setStatus(next.status);
        if (next.status === 'active') await client.refresh();
      }
      return next;
    }).catch((cause: unknown) => {
      const normalized = cause instanceof BillingRequestError
        ? cause : new BillingRequestError({ status: null });
      setError(normalized);
      setStatus('error');
      return null;
    }).finally(() => {
      active.current = null;
    });
    active.current = request;
    return request;
  }, [client, userId]);
  const reset = React.useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);
  return React.useMemo(() => ({ start, status, result, error, reset }), [error, reset, result, start, status]);
}

type CheckoutReturnStatus = 'none' | 'confirming' | 'confirmed' | 'unconfirmed';
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
        const subscription = client.getSnapshot().subscription;
        if (subscription?.productId === marker.productId
          && !UNCONFIRMED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
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

type PortalHookStatus = 'idle' | 'pending' | 'redirecting' | 'error' | PortalResult['status'];
export function useCustomerPortal(): Readonly<{
  open(params?: Readonly<{ returnPath?: string }>): Promise<PortalResult | null>;
  status: PortalHookStatus;
  error: BillingRequestError | null;
}> {
  const client = useBillingClient();
  const [status, setStatus] = React.useState<PortalHookStatus>('idle');
  const [error, setError] = React.useState<BillingRequestError | null>(null);
  const open = React.useCallback(async (params?: Readonly<{ returnPath?: string }>) => {
    setStatus('pending');
    setError(null);
    try {
      const result = await client.portal(params);
      if (result.status === 'redirect') {
        setStatus('redirecting');
        navigateToHostedPage(result.url);
      } else setStatus(result.status);
      return result;
    } catch (cause) {
      const normalized = cause instanceof BillingRequestError
        ? cause : new BillingRequestError({ status: null });
      setError(normalized);
      setStatus('error');
      return null;
    }
  }, [client]);
  return React.useMemo(() => ({ open, status, error }), [error, open, status]);
}

function safeReturnPath(value: string | undefined): string {
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

function checkoutErrorKey(status: CheckoutHookStatus, error: BillingRequestError | null): BillingMessageKey {
  if (error?.status === 429) return 'checkout.error.rateLimited';
  if (status === 'checkout_unavailable') return 'checkout.error.unavailable';
  if (status === 'product_unavailable') return 'checkout.error.productUnavailable';
  if (status === 'pending') return 'checkout.error.slow';
  return 'checkout.error.generic';
}

function checkoutStatusMessage(
  t: (key: BillingMessageKey, values?: Record<string, string | number>) => string,
  status: CheckoutHookStatus,
  error: BillingRequestError | null,
  result: CheckoutResult | null,
  plan: string,
): string {
  if (status === 'role_required') return t('pricing.roleRequired');
  if (status === 'no_organization') return t('pricing.selectOrganization');
  if (status === 'already_subscribed') return t('checkout.alreadySubscribed');
  if (status === 'checkout_open' && result?.status === 'checkout_open') {
    return t('checkout.openElsewhere', { plan, currency: result.currency });
  }
  return t(checkoutErrorKey(status, error));
}

function CheckoutDisclosure({ provider, hidden, appearance }: Readonly<{
  provider: string | null; hidden?: boolean; appearance?: BillingAppearance;
}>): React.JSX.Element {
  const t = useBillingText();
  const providerName = provider ? PROVIDERS[provider] : undefined;
  return <p className={`${billingSlot('pricing-disclosure', appearance)}${hidden ? ' ao-sr-only' : ''}`}>
    {providerName
      ? t('checkout.disclosure.provider', { provider: providerName })
      : t('checkout.disclosure.generic')}
  </p>;
}

export type CheckoutButtonProps = Readonly<{
  productId: string;
  currency?: string;
  returnPath?: string;
  disclosure?: 'visible' | 'visually-hidden';
  onComplete?(productId: string): void;
  appearance?: BillingAppearance;
  children?: React.ReactNode;
}>;

export function CheckoutButton(props: CheckoutButtonProps): React.JSX.Element | null {
  const { onComplete, productId } = props;
  const pricing = usePricing({ currency: props.currency });
  const checkout = useCheckout();
  const portal = useCustomerPortal();
  const entitlement = useEntitlements();
  const { isLoaded, isSignedIn } = useAuth();
  const t = useBillingText();
  const shared = useSharedSlots();
  const product = pricing.products.find((candidate) => candidate.id === productId);
  React.useEffect(() => {
    if (pricing.status !== 'loading' && pricing.status !== 'error' && !product
      && process.env.NODE_ENV !== 'production') {
      console.warn(`[AuthOwl] Billing product ${productId} has no price in ${pricing.currency ?? 'the selected currency'}.`);
    }
  }, [pricing.currency, pricing.status, product, productId]);
  React.useEffect(() => {
    if (checkout.status === 'active') onComplete?.(productId);
  }, [checkout.status, onComplete, productId]);
  React.useEffect(() => {
    if ((checkout.status === 'not_connected' || checkout.status === 'erased')
      && process.env.NODE_ENV !== 'production') {
      console.warn(`[AuthOwl] Checkout returned ${checkout.status}.`);
    }
  }, [checkout.status]);
  if (!product && pricing.status !== 'loading') return null;
  const isCurrent = entitlement.subscription?.productId === productId;
  const pending = checkout.status === 'pending' || checkout.status === 'redirecting'
    || portal.status === 'pending' || portal.status === 'redirecting';
  const label = checkout.status === 'checkout_open'
    ? t('checkout.continue')
    : props.children ?? (isCurrent ? t('pricing.manage') : t('pricing.subscribe'));
  const click = () => {
    if (isCurrent) void portal.open({ returnPath: safeReturnPath(props.returnPath) });
    else if (product && pricing.currency) void checkout.start({
      productId: product.id,
      currency: checkout.result?.status === 'checkout_open' ? checkout.result.currency : pricing.currency,
      returnPath: safeReturnPath(props.returnPath),
    });
  };
  const status = isCurrent ? portal.status : checkout.status;
  const error = isCurrent ? portal.error : checkout.error;
  return <span className={billingSlot('pricing-cta', props.appearance)}>
    <button
      type="button"
      className={`${shared('button')} ${billingSlot('checkout-button', props.appearance)}`}
      disabled={!isLoaded || !isSignedIn || pricing.status === 'loading' || pending}
      aria-busy={pending || undefined}
      aria-label={isCurrent ? `${t('pricing.manage')}: ${product?.name ?? productId}`
        : t('pricing.subscribeTo', { plan: product?.name ?? productId })}
      onClick={click}
    >{pending ? (status === 'redirecting' ? t('checkout.redirecting') : isCurrent
      ? t('portal.pending') : t('checkout.pending')) : label}</button>
    {(status === 'error' || (status !== 'idle' && status !== 'pending' && status !== 'redirecting'
      && status !== 'active' && status !== 'redirect' && status !== 'not_connected'))
      ? <p role="alert" className={`${shared('error')} ${billingSlot('checkout-error', props.appearance)}`}>
        {isCurrent ? t('portal.error') : checkoutStatusMessage(
          t,
          status as CheckoutHookStatus,
          error,
          checkout.result,
          product?.name ?? productId,
        )}
      </p> : null}
    <CheckoutDisclosure provider={pricing.provider} hidden={props.disclosure === 'visually-hidden'} appearance={props.appearance} />
  </span>;
}

export type CustomerPortalLinkProps = Readonly<{
  returnPath?: string;
  fallback?: React.ReactNode;
  appearance?: BillingAppearance;
  children?: React.ReactNode;
}>;

export function CustomerPortalLink(props: CustomerPortalLinkProps): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth();
  const entitlement = useEntitlements();
  const portal = useCustomerPortal();
  const t = useBillingText();
  const shared = useSharedSlots();
  if (isLoaded && (!isSignedIn || entitlement.reason === 'no_customer' || !entitlement.canManage)) {
    return <>{props.fallback ?? null}</>;
  }
  const pending = portal.status === 'pending' || portal.status === 'redirecting';
  const disclosure = t('portal.disclosure');
  return <span>
    <button
      type="button"
      className={`${shared('button-secondary')} ${billingSlot('portal-link', props.appearance)}`}
      title={disclosure}
      disabled={!isLoaded || entitlement.isLoading || pending}
      aria-busy={pending || undefined}
      onClick={() => void portal.open({ returnPath: safeReturnPath(props.returnPath) })}
    >{pending ? t('portal.pending') : props.children ?? t('portal.open')}</button>
    <span className="ao-sr-only">{disclosure}</span>
    {portal.status === 'error' ? <p role="alert" className={shared('error')}>{t('portal.error')}</p> : null}
  </span>;
}

export type PricingTableProps = Readonly<{
  currency?: string;
  showCurrencySwitcher?: boolean;
  onCurrencyChange?(currency: string): void;
  productIds?: readonly string[];
  highlight?: string;
  highlightLabel?: string;
  cta?: Readonly<Record<string, Readonly<{ label?: string; href?: string }>>>;
  signInUrl?: string;
  returnPath?: string;
  onCheckoutComplete?(productId: string): void;
  appearance?: BillingAppearance;
}>;

function FeatureList({ product, locale, appearance }: Readonly<{
  product: PricingProduct; locale: BillingLocale; appearance?: BillingAppearance;
}>): React.JSX.Element | null {
  const t = useBillingText();
  if (product.features.length === 0) return null;
  return <ul className={billingSlot('pricing-features', appearance)}>{product.features.map((feature) => {
    let text = t('feature.included', { feature: feature.name });
    if (feature.kind === 'metered') {
      if (feature.allowance === null) text = t('feature.unlimited', { feature: feature.name });
      else if (feature.resetInterval) text = t('feature.allowance', {
        feature: feature.name, count: formatCount(feature.allowance, locale), interval: feature.resetInterval,
      });
      else text = t('feature.allowanceOnce', {
        feature: feature.name, count: formatCount(feature.allowance, locale),
      });
    }
    return <li key={feature.feature} className={billingSlot('pricing-feature', appearance)}>{text}</li>;
  })}</ul>;
}

export function PricingTable(props: PricingTableProps): React.JSX.Element | null {
  const pricing = usePricing({ currency: props.currency });
  const entitlement = useEntitlements();
  const { isLoaded, isSignedIn } = useAuth();
  const locale = useLocale() as BillingLocale;
  const t = useBillingText();
  const shared = useSharedSlots();
  const returned = useCheckoutReturn({ onComplete: props.onCheckoutComplete });
  React.useEffect(() => {
    if (pricing.status === 'not_connected' && process.env.NODE_ENV !== 'production') {
      console.warn('[AuthOwl] Billing is not connected for this project.');
    }
  }, [pricing.status]);
  if (pricing.status === 'not_connected') return null;
  const byId = new Map(pricing.products.map((product) => [product.id, product]));
  const products = props.productIds
    ? props.productIds.flatMap((id) => byId.get(id) ?? [])
    : pricing.products;
  const showSwitcher = props.showCurrencySwitcher
    ?? (props.currency === undefined && pricing.currencies.length > 1);
  const returnPlan = returned.productId ? byId.get(returned.productId)?.name ?? returned.productId : '';
  return <section className={billingSlot('pricing-table', props.appearance)}>
    {pricing.environment === 'sandbox' ? <p className={`${shared('badge')} ${billingSlot('pricing-test-mode', props.appearance)}`}>
      {t('pricing.testMode')} <span className={shared('muted')}>{t('pricing.testModeHint')}</span>
    </p> : null}
    {returned.status !== 'none' ? <div aria-live="polite" className={billingSlot('pricing-status', props.appearance)}>
      <p>{returned.status === 'confirming' ? t('return.confirming')
        : returned.status === 'confirmed' ? t('return.confirmed', { plan: returnPlan })
          : t('return.unconfirmed')}</p>
      <button type="button" className={shared('button-secondary')} onClick={returned.dismiss}>{t('return.dismiss')}</button>
    </div> : null}
    {showSwitcher ? <label className={billingSlot('pricing-toolbar', props.appearance)}>
      <span>{t('pricing.currencyLabel')}</span>
      <select className={billingSlot('pricing-currency', props.appearance)} value={pricing.currency ?? ''}
        onChange={(event) => {
          pricing.setCurrency(event.target.value);
          props.onCurrencyChange?.(event.target.value);
        }}>
        {pricing.currencies.map((currency) => <option key={currency}>{currency}</option>)}
      </select>
    </label> : null}
    {pricing.status === 'loading' ? <div role="status" aria-busy="true" aria-label={t('pricing.loading')} className={billingSlot('pricing-grid', props.appearance)}>
      {[0, 1, 2].map((index) => <div key={index} className={`${shared('skeleton')} ${billingSlot('pricing-card', props.appearance)}`} />)}
    </div> : null}
    {pricing.status === 'error' ? <div className={billingSlot('pricing-status', props.appearance)}>
      <p className={shared('error')}>{t('pricing.error')}</p>
      <button type="button" className={shared('button-secondary')} onClick={() => void pricing.refresh()}>{t('pricing.retry')}</button>
    </div> : null}
    {pricing.status === 'empty' || (pricing.status === 'ready' && products.length === 0)
      ? <p className={billingSlot('pricing-status', props.appearance)}>{pricing.currency
        ? t('pricing.empty', { currency: pricing.currency }) : t('pricing.emptyAll')}</p> : null}
    {pricing.status === 'ready' && products.length > 0 ? <div role="list" className={billingSlot('pricing-grid', props.appearance)}>
      {products.map((product) => {
        const price = product.prices[0]!;
        const highlighted = product.id === props.highlight;
        const current = entitlement.subscription?.productId === product.id;
        const cta = props.cta?.[product.id];
        const intervalKey = price.intervalCount === 1
          ? `pricing.perInterval.${price.interval}` as BillingMessageKey
          : `pricing.everyInterval.${price.interval}` as BillingMessageKey;
        const interval = t(intervalKey, { count: formatCount(price.intervalCount, locale) });
        let action: React.ReactNode;
        if (cta?.href) action = <a className={`${shared('button')} ${billingSlot('pricing-cta', props.appearance)}`}
          href={cta.href} aria-label={`${cta.label ?? t('pricing.subscribe')}: ${product.name}`}>{cta.label ?? t('pricing.subscribe')}</a>;
        else if (!isLoaded || entitlement.isLoading) action = <button type="button" className={shared('button')} disabled aria-busy>{cta?.label ?? t('pricing.subscribe')}</button>;
        else if (!isSignedIn) action = props.signInUrl
          ? <a className={shared('button')} href={props.signInUrl} aria-label={`${t('pricing.signIn')}: ${product.name}`}>{t('pricing.signIn')}</a>
          : <button type="button" className={shared('button')} disabled title={t('pricing.signIn')}>{t('pricing.signIn')}</button>;
        else if (entitlement.reason === 'no_organization') action = <p className={billingSlot('pricing-note', props.appearance)}>{t('pricing.selectOrganization')}</p>;
        else if (entitlement.subscription) action = <CustomerPortalLink appearance={props.appearance} returnPath={props.returnPath}>{t('pricing.manage')}</CustomerPortalLink>;
        else action = <CheckoutButton productId={product.id} currency={pricing.currency ?? undefined}
          returnPath={props.returnPath} disclosure="visually-hidden" appearance={props.appearance}
          onComplete={props.onCheckoutComplete}>{cta?.label}</CheckoutButton>;
        return <div role="listitem" key={product.id} aria-labelledby={`ao-plan-${product.id}`}
          className={`${shared('card')} ${billingSlot('pricing-card', props.appearance)}${highlighted ? ` ${billingSlot('pricing-card-highlighted', props.appearance)}` : ''}`}>
          {highlighted ? <span className={`${shared('badge')} ${billingSlot('pricing-badge', props.appearance)}`}>{props.highlightLabel ?? t('pricing.highlight')}</span> : null}
          {current ? <span className={`${shared('badge')} ${billingSlot('pricing-badge', props.appearance)}`}>{t('pricing.currentPlan')}</span> : null}
          <h2 id={`ao-plan-${product.id}`} className={billingSlot('pricing-name', props.appearance)}>{product.name}</h2>
          <p className={billingSlot('pricing-price', props.appearance)}>
            <span className={billingSlot('pricing-amount', props.appearance)}><bdi>{price.amount === 0 ? t('pricing.free') : formatPrice(price.amount, price.currency, price.exponent, locale)}</bdi></span>{' '}
            {price.kind === 'licensed' ? <span className={billingSlot('pricing-interval', props.appearance)}>{t('pricing.perUnit')}</span>
              : <span className={billingSlot('pricing-interval', props.appearance)}>{interval}</span>}
          </p>
          <FeatureList product={product} locale={locale} appearance={props.appearance} />
          {price.hasUsage ? <p className={billingSlot('pricing-note', props.appearance)}>{t('pricing.usageNote')}</p> : null}
          <div className={billingSlot('pricing-cta', props.appearance)}>{action}</div>
          <CheckoutDisclosure provider={pricing.provider} appearance={props.appearance} />
          <p className={`${shared('muted')} ${billingSlot('pricing-note', props.appearance)}`}>{t('pricing.taxNote')}</p>
        </div>;
      })}
    </div> : null}
  </section>;
}
