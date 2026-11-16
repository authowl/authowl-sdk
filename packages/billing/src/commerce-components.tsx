'use client';
import * as React from 'react';
import { slot, useAuth, useAuthOwlContext, useLocale } from '@authowl/react';
import { billingMessage, type BillingLocale, type BillingMessageKey } from './i18n';
import { formatCount, formatPrice } from './money';
import { useEntitlements } from './react-base';
import {
  activeSubscription,
  safeReturnPath,
  useCheckout,
  useCheckoutReturn,
  useCustomerPortal,
  usePricing,
  type CheckoutHookResult,
  type CheckoutHookStatus,
} from './commerce-hooks';
import type { BillingRequestError } from './store';
import type { PricingProduct } from './wire';

export type BillingElementSlot =
  | 'pricing-table' | 'pricing-toolbar' | 'pricing-currency' | 'pricing-grid'
  | 'pricing-card' | 'pricing-card-highlighted' | 'pricing-badge' | 'pricing-name'
  | 'pricing-price' | 'pricing-amount' | 'pricing-interval' | 'pricing-features'
  | 'pricing-feature' | 'pricing-cta' | 'pricing-note' | 'pricing-disclosure'
  | 'pricing-status' | 'pricing-test-mode' | 'checkout-button' | 'checkout-error'
  | 'portal-link';

export type BillingElements = Partial<Record<BillingElementSlot, string>>;
export type BillingAppearance = Readonly<{ elements?: BillingElements }>;

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

function checkoutErrorKey(status: CheckoutHookStatus, error: BillingRequestError | null): BillingMessageKey {
  if (error?.status === 429) return 'checkout.error.rateLimited';
  if (status === 'checkout_unavailable') return 'checkout.error.unavailable';
  if (status === 'product_unavailable') return 'checkout.error.productUnavailable';
  if (status === 'slow') return 'checkout.error.slow';
  return 'checkout.error.generic';
}

function checkoutStatusMessage(
  t: (key: BillingMessageKey, values?: Record<string, string | number>) => string,
  status: CheckoutHookStatus,
  error: BillingRequestError | null,
  result: CheckoutHookResult | null,
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
  const providerName = provider === 'paymob' ? 'Paymob' : provider === 'stripe' ? 'Stripe' : undefined;
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
  disclosure?: 'visible' | 'visually-hidden' | 'none';
  onComplete?(productId: string): void;
  appearance?: BillingAppearance;
  children?: React.ReactNode;
}>;

export function CheckoutButton(props: CheckoutButtonProps): React.JSX.Element | null {
  const { productId } = props;
  const pricing = usePricing({ currency: props.currency });
  const checkout = useCheckout();
  const portal = useCustomerPortal();
  const entitlement = useEntitlements();
  const { isLoaded, isSignedIn } = useAuth();
  const t = useBillingText();
  const shared = useSharedSlots();
  const product = pricing.products.find((candidate) => candidate.id === productId);
  const subscription = activeSubscription(entitlement.subscription);
  const onComplete = React.useRef(props.onComplete);
  const previousCheckoutStatus = React.useRef(checkout.status);
  onComplete.current = props.onComplete;
  React.useEffect(() => {
    if ((pricing.status === 'ready' || pricing.status === 'empty') && !product
      && process.env.NODE_ENV !== 'production') {
      console.warn(`[AuthOwl] Billing product ${productId} has no price in ${pricing.currency ?? 'the selected currency'}.`);
    }
  }, [pricing.currency, pricing.status, product, productId]);
  React.useEffect(() => {
    if (checkout.status === 'active' && previousCheckoutStatus.current !== 'active') {
      onComplete.current?.(productId);
    }
    previousCheckoutStatus.current = checkout.status;
  }, [checkout.status, productId]);
  React.useEffect(() => {
    if ((checkout.status === 'not_connected' || checkout.status === 'erased')
      && process.env.NODE_ENV !== 'production') {
      console.warn(`[AuthOwl] Checkout returned ${checkout.status}.`);
    }
  }, [checkout.status]);
  if (!product && pricing.status === 'error') {
    return <span className={billingSlot('pricing-cta', props.appearance)}>
      <p role="alert" className={`${shared('error')} ${billingSlot('checkout-error', props.appearance)}`}>{t('pricing.error')}</p>
      <button type="button" className={shared('button-secondary')}
        onClick={() => void pricing.refresh().catch(() => undefined)}>{t('pricing.retry')}</button>
    </span>;
  }
  if (!product && pricing.status !== 'loading') return null;
  const opensPortal = subscription !== null;
  const pending = checkout.status === 'pending' || checkout.status === 'redirecting'
    || portal.status === 'pending' || portal.status === 'redirecting';
  const status = opensPortal ? portal.status : checkout.status;
  const error = opensPortal ? portal.error : checkout.error;
  const stateLabel = pending
    ? (status === 'redirecting' ? t('checkout.redirecting')
      : opensPortal ? t('portal.pending') : t('checkout.pending'))
    : checkout.status === 'checkout_open' ? t('checkout.continue') : null;
  const defaultLabel = opensPortal ? t('pricing.manage') : t('pricing.subscribe');
  const visibleLabel = stateLabel ?? props.children ?? defaultLabel;
  const accessibleLabel = stateLabel || props.children
    ? undefined
    : opensPortal
      ? `${defaultLabel}: ${product?.name ?? productId}`
      : t('pricing.subscribeTo', { plan: product?.name ?? productId });
  const click = () => {
    if (opensPortal) void portal.open({ returnPath: safeReturnPath(props.returnPath) });
    else if (product && pricing.currency) void checkout.start({
      productId: product.id,
      currency: checkout.result?.status === 'checkout_open' ? checkout.result.currency : pricing.currency,
      returnPath: safeReturnPath(props.returnPath),
    });
  };
  const showsError = status === 'error'
    || !['idle', 'pending', 'redirecting', 'active', 'redirect'].includes(status);
  return <span className={billingSlot('pricing-cta', props.appearance)}>
    <button
      type="button"
      className={`${shared('button')} ${billingSlot('checkout-button', props.appearance)}`}
      disabled={!isLoaded || !isSignedIn || pricing.status === 'loading' || pending}
      aria-busy={pending || undefined}
      aria-label={accessibleLabel}
      onClick={click}
    >{visibleLabel}</button>
    {showsError ? <p role="alert" className={`${shared('error')} ${billingSlot('checkout-error', props.appearance)}`}>
      {opensPortal ? t('portal.error') : checkoutStatusMessage(
        t,
        status as CheckoutHookStatus,
        error,
        checkout.result,
        product?.name ?? productId,
      )}
    </p> : null}
    {props.disclosure === 'none' ? null : opensPortal
      ? <p className={`${billingSlot('pricing-disclosure', props.appearance)}${props.disclosure === 'visually-hidden' ? ' ao-sr-only' : ''}`}>{t('portal.disclosure')}</p>
      : <CheckoutDisclosure
        provider={pricing.provider}
        hidden={props.disclosure === 'visually-hidden'}
        appearance={props.appearance}
      />}
  </span>;
}

export type CustomerPortalLinkProps = Readonly<{
  returnPath?: string;
  fallback?: React.ReactNode;
  disclosure?: 'assistive' | 'none';
  appearance?: BillingAppearance;
  children?: React.ReactNode;
}>;

export function CustomerPortalLink(props: CustomerPortalLinkProps): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAuth();
  const entitlement = useEntitlements();
  const portal = useCustomerPortal();
  const t = useBillingText();
  const shared = useSharedSlots();
  if (isLoaded && !entitlement.isLoading
    && (!isSignedIn || entitlement.reason === 'no_customer' || !entitlement.canManage)) {
    return <>{props.fallback ?? null}</>;
  }
  const pending = portal.status === 'pending' || portal.status === 'redirecting';
  const disclosure = t('portal.disclosure');
  const showsError = portal.status === 'error'
    || !['idle', 'pending', 'redirecting', 'redirect'].includes(portal.status);
  return <span>
    <button
      type="button"
      className={`${shared('button-secondary')} ${billingSlot('portal-link', props.appearance)}`}
      title={disclosure}
      disabled={!isLoaded || entitlement.isLoading || pending}
      aria-busy={pending || undefined}
      onClick={() => void portal.open({ returnPath: safeReturnPath(props.returnPath) })}
    >{pending ? t('portal.pending') : props.children ?? t('portal.open')}</button>
    {props.disclosure === 'none' ? null : <span className="ao-sr-only">{disclosure}</span>}
    {showsError ? <p role="alert" className={shared('error')}>{t('portal.error')}</p> : null}
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
        feature: feature.name,
        count: formatCount(feature.allowance, locale),
        interval: t(`pricing.perInterval.${feature.resetInterval}`),
      });
      else text = t('feature.allowanceOnce', {
        feature: feature.name, count: formatCount(feature.allowance, locale),
      });
    }
    return <li key={feature.feature} className={billingSlot('pricing-feature', appearance)}><bdi>{text}</bdi></li>;
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
  const tableId = React.useId();
  const subscription = activeSubscription(entitlement.subscription);
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
  const returnMessage = returned.status === 'none' ? ''
    : returned.status === 'confirming' ? t('return.confirming')
      : returned.status === 'confirmed' ? t('return.confirmed', { plan: returnPlan })
        : t('return.unconfirmed');
  return <section className={billingSlot('pricing-table', props.appearance)}>
    {pricing.environment === 'sandbox' ? <p className={`${shared('badge')} ${billingSlot('pricing-test-mode', props.appearance)}`}>
      {t('pricing.testMode')} <span className={shared('muted')}>{t('pricing.testModeHint')}</span>
    </p> : null}
    <div aria-live="polite" className={returned.status === 'none'
      ? 'ao-sr-only' : billingSlot('pricing-status', props.appearance)}>
      <p>{returnMessage}</p>
      {returned.status === 'none' ? null : <button type="button" className={shared('button-secondary')} onClick={returned.dismiss}>{t('return.dismiss')}</button>}
    </div>
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
      <button type="button" className={shared('button-secondary')} onClick={() => void pricing.refresh().catch(() => undefined)}>{t('pricing.retry')}</button>
    </div> : null}
    {pricing.status === 'empty' || (pricing.status === 'ready' && products.length === 0)
      ? <p className={billingSlot('pricing-status', props.appearance)}>{pricing.currency
        ? t('pricing.empty', { currency: pricing.currency }) : t('pricing.emptyAll')}</p> : null}
    {pricing.status === 'ready' && products.length > 0 ? <div role="list" className={billingSlot('pricing-grid', props.appearance)}>
      {products.map((product) => {
        const price = product.prices[0]!;
        const highlighted = product.id === props.highlight;
        const current = subscription?.productId === product.id;
        const cta = props.cta?.[product.id];
        const intervalKey = price.intervalCount === 1
          ? `pricing.perInterval.${price.interval}` as BillingMessageKey
          : `pricing.everyInterval.${price.interval}` as BillingMessageKey;
        const interval = t(intervalKey, { count: formatCount(price.intervalCount, locale) });
        const headingId = `ao-plan-${tableId}-${product.id}`;
        let action: React.ReactNode;
        let actionKind: 'checkout' | 'portal' | 'other' = 'other';
        if (cta?.href) action = <a className={`${shared('button')} ${billingSlot('pricing-cta', props.appearance)}`}
          href={cta.href} aria-label={`${cta.label ?? t('pricing.subscribe')}: ${product.name}`}>{cta.label ?? t('pricing.subscribe')}</a>;
        else if (!isLoaded || entitlement.isLoading) action = <button type="button" className={shared('button')} disabled aria-busy>{cta?.label ?? t('pricing.subscribe')}</button>;
        else if (!isSignedIn) action = props.signInUrl
          ? <a className={shared('button')} href={props.signInUrl} aria-label={`${t('pricing.signIn')}: ${product.name}`}>{t('pricing.signIn')}</a>
          : <button type="button" className={shared('button')} disabled title={t('pricing.signIn')}>{t('pricing.signIn')}</button>;
        else if (entitlement.reason === 'no_organization') action = <p className={billingSlot('pricing-note', props.appearance)}>{t('pricing.selectOrganization')}</p>;
        else if ((entitlement.reason === 'ok' || entitlement.reason === 'no_customer') && !entitlement.canManage) {
          action = <p className={billingSlot('pricing-note', props.appearance)}>{t('pricing.roleRequired')}</p>;
        } else if (subscription) {
          actionKind = 'portal';
          action = <CustomerPortalLink disclosure="none" appearance={props.appearance} returnPath={props.returnPath}>{t('pricing.manage')}</CustomerPortalLink>;
        } else {
          actionKind = 'checkout';
          action = <CheckoutButton productId={product.id} currency={pricing.currency ?? undefined}
            returnPath={props.returnPath} disclosure="none" appearance={props.appearance}
            onComplete={props.onCheckoutComplete}>{cta?.label}</CheckoutButton>;
        }
        return <div role="listitem" key={product.id} aria-labelledby={headingId}
          className={`${shared('card')} ${billingSlot('pricing-card', props.appearance)}${highlighted ? ` ${billingSlot('pricing-card-highlighted', props.appearance)}` : ''}`}>
          {highlighted ? <span className={`${shared('badge')} ${billingSlot('pricing-badge', props.appearance)}`}>{props.highlightLabel ?? t('pricing.highlight')}</span> : null}
          {current ? <span className={`${shared('badge')} ${billingSlot('pricing-badge', props.appearance)}`}>{t('pricing.currentPlan')}</span> : null}
          <h2 id={headingId} className={billingSlot('pricing-name', props.appearance)}>{product.name}</h2>
          <p className={billingSlot('pricing-price', props.appearance)}>
            <span className={billingSlot('pricing-amount', props.appearance)}><bdi>{price.amount === 0 ? t('pricing.free') : formatPrice(price.amount, price.currency, price.exponent, locale)}</bdi></span>{' '}
            <span className={billingSlot('pricing-interval', props.appearance)}>
              {price.kind === 'licensed' ? `${t('pricing.perUnit')} ${interval}` : interval}
            </span>
          </p>
          <FeatureList product={product} locale={locale} appearance={props.appearance} />
          {price.hasUsage ? <p className={billingSlot('pricing-note', props.appearance)}>{t('pricing.usageNote')}</p> : null}
          <div className={billingSlot('pricing-cta', props.appearance)}>{action}</div>
          {actionKind === 'checkout' ? <CheckoutDisclosure provider={pricing.provider} appearance={props.appearance} /> : null}
          {actionKind === 'portal' ? <p className={billingSlot('pricing-disclosure', props.appearance)}>{t('portal.disclosure')}</p> : null}
          <p className={`${shared('muted')} ${billingSlot('pricing-note', props.appearance)}`}>{t('pricing.taxNote')}</p>
        </div>;
      })}
    </div> : null}
  </section>;
}
