const BILLING_REASONS = [
  'not_connected',
  'no_customer',
  'erased',
  'no_organization',
] as const;
const ENTITLEMENT_STATUSES = ['ok', ...BILLING_REASONS] as const;
const CHECK_REASONS = [...BILLING_REASONS, 'not_granted'] as const;
const ENTITLEMENT_SOURCES = ['snapshot', 'live', 'none'] as const;
const BILLING_SUBJECT_TYPES = ['user', 'organization'] as const;
const ENVIRONMENTS = ['sandbox', 'live'] as const;
const CUSTOMER_TYPES = ['user', 'organization'] as const;
const INTERVALS = ['day', 'week', 'month', 'year'] as const;
const PRICE_KINDS = ['fixed_recurring', 'licensed'] as const;
const FEATURE_KINDS = ['boolean', 'metered'] as const;
const CATALOG_STATUSES = ['ok', 'not_connected'] as const;
const MAX_PRODUCTS = 50;
const MAX_FEATURES = 30;
const MAX_CURRENCIES = 1_000;

export type BillingReason = typeof BILLING_REASONS[number];
export type EntitlementStatus = typeof ENTITLEMENT_STATUSES[number];
export type EntitlementSource = typeof ENTITLEMENT_SOURCES[number];

export type BillingSubject = Readonly<{
  type: typeof BILLING_SUBJECT_TYPES[number];
  id: string;
}>;

export type EntitlementView = Readonly<{
  feature: string;
  kind: string;
  allowed: boolean;
  balance: number | null;
}>;

export type BillingSubscription = Readonly<{
  productId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}>;

export type EntitlementList = Readonly<{
  status: EntitlementStatus;
  subject: BillingSubject | null;
  source: EntitlementSource;
  fetchedAt: string | null;
  entitlements: readonly EntitlementView[];
  subscription: BillingSubscription | null;
  canManage: boolean;
}>;

export type EntitlementCheck = Readonly<{
  feature: string;
  allowed: boolean;
  kind: string | null;
  balance: number | null;
  reason: BillingReason | 'not_granted' | null;
  source: EntitlementSource;
}>;

export type PricingCatalog = Readonly<{
  status: typeof CATALOG_STATUSES[number];
  environment: typeof ENVIRONMENTS[number];
  customerType: typeof CUSTOMER_TYPES[number];
  defaultCurrency: string | null;
  currencies: readonly string[];
  providers: Readonly<Record<string, string>>;
  products: readonly PricingProduct[];
}>;

export type PricingProduct = Readonly<{
  id: string;
  name: string;
  prices: readonly PricingPrice[];
  features: readonly PricingFeature[];
}>;

export type PricingPrice = Readonly<{
  currency: string;
  amount: number;
  exponent: number;
  interval: typeof INTERVALS[number];
  intervalCount: number;
  kind: typeof PRICE_KINDS[number];
  hasUsage: boolean;
}>;

export type PricingFeature = Readonly<{
  feature: string;
  name: string;
  kind: typeof FEATURE_KINDS[number];
  allowance: number | null;
  resetInterval: typeof INTERVALS[number] | null;
}>;

export type CheckoutResult =
  | Readonly<{
    status: 'redirect';
    url: string;
    productId: string;
    currency: string;
    expiresAt: string;
  }>
  | Readonly<{ status: 'active'; productId: string }>
  | Readonly<{ status: 'pending'; retryAfterSeconds?: number }>
  | Readonly<{
    status: 'checkout_open';
    productId: string;
    currency: string;
    expiresAt: string;
  }>
  | Readonly<{ status: 'already_subscribed'; productId: string }>
  | Readonly<{
    status:
      | 'product_unavailable'
      | 'checkout_unavailable'
      | 'not_connected'
      | 'no_organization'
      | 'role_required'
      | 'erased';
  }>;

export type PortalResult =
  | Readonly<{ status: 'redirect'; url: string; expiresAt: string }>
  | Readonly<{
    status:
      | 'not_connected'
      | 'no_organization'
      | 'role_required'
      | 'no_customer'
      | 'erased';
  }>;

export function decodeEntitlementList(value: unknown): EntitlementList {
  const row = record(value);
  const entitlements = array(row.entitlements, 1000);
  return Object.freeze({
    status: oneOf(row.status, ENTITLEMENT_STATUSES),
    subject: decodeSubject(row.subject),
    source: oneOf(row.source, ENTITLEMENT_SOURCES),
    fetchedAt: nullableString(row.fetchedAt),
    entitlements: Object.freeze(entitlements.map(decodeEntitlement)),
    subscription: row.subscription === undefined ? null : decodeSubscription(row.subscription),
    canManage: row.canManage === undefined ? false : boolean(row.canManage),
  });
}

export function decodeEntitlementCheck(value: unknown): EntitlementCheck {
  const row = record(value);
  const reason = row.reason === null ? null : oneOf(row.reason, CHECK_REASONS);
  return Object.freeze({
    feature: string(row.feature),
    allowed: boolean(row.allowed),
    kind: nullableString(row.kind),
    balance: nullableNumber(row.balance),
    reason,
    source: oneOf(row.source, ENTITLEMENT_SOURCES),
  });
}

export function decodePricingCatalog(value: unknown): PricingCatalog {
  const row = record(value);
  const providers = record(row.providers);
  const providerEntries = Object.entries(providers).map(([providerCurrency, provider]) => {
    const providerName = string(provider);
    if (!isCurrency(providerCurrency) || !/^[a-z0-9_-]{1,32}$/.test(providerName)) invalid();
    return [providerCurrency, providerName] as const;
  });
  if (providerEntries.length > MAX_CURRENCIES) invalid();
  return Object.freeze({
    status: oneOf(row.status, CATALOG_STATUSES),
    environment: oneOf(row.environment, ENVIRONMENTS),
    customerType: oneOf(row.customerType, CUSTOMER_TYPES),
    defaultCurrency: nullableCurrency(row.defaultCurrency),
    currencies: Object.freeze(array(row.currencies, MAX_CURRENCIES).map(currency)),
    providers: Object.freeze(Object.fromEntries(providerEntries)),
    products: Object.freeze(array(row.products, MAX_PRODUCTS).map(decodeProduct)),
  });
}

export function decodeCheckoutResult(value: unknown): CheckoutResult {
  const row = record(value);
  const status = string(row.status);
  switch (status) {
    case 'redirect':
      return Object.freeze({
        status,
        url: safeWebUrl(row.url),
        productId: string(row.productId),
        currency: currency(row.currency),
        expiresAt: string(row.expiresAt),
      });
    case 'active':
    case 'already_subscribed':
      return Object.freeze({ status, productId: string(row.productId) });
    case 'pending':
      return Object.freeze({
        status,
        retryAfterSeconds: positiveInteger(row.retryAfterSeconds),
      });
    case 'checkout_open':
      return Object.freeze({
        status,
        productId: string(row.productId),
        currency: currency(row.currency),
        expiresAt: string(row.expiresAt),
      });
    case 'product_unavailable':
    case 'checkout_unavailable':
    case 'not_connected':
    case 'no_organization':
    case 'role_required':
    case 'erased':
      return Object.freeze({ status });
    default:
      return invalid();
  }
}

export function decodePortalResult(value: unknown): PortalResult {
  const row = record(value);
  const status = string(row.status);
  switch (status) {
    case 'redirect':
      return Object.freeze({
        status,
        url: safeWebUrl(row.url),
        expiresAt: string(row.expiresAt),
      });
    case 'not_connected':
    case 'no_organization':
    case 'role_required':
    case 'no_customer':
    case 'erased':
      return Object.freeze({ status });
    default:
      return invalid();
  }
}

function decodeProduct(value: unknown): PricingProduct {
  const row = record(value);
  return Object.freeze({
    id: string(row.id),
    name: string(row.name),
    prices: Object.freeze(array(row.prices, MAX_CURRENCIES).map(decodePrice)),
    features: Object.freeze(array(row.features, MAX_FEATURES).map(decodeFeature)),
  });
}

function decodePrice(value: unknown): PricingPrice {
  const row = record(value);
  return Object.freeze({
    currency: currency(row.currency),
    amount: nonnegativeInteger(row.amount),
    exponent: boundedNonnegativeInteger(row.exponent, 4),
    interval: oneOf(row.interval, INTERVALS),
    intervalCount: positiveInteger(row.intervalCount),
    kind: oneOf(row.kind, PRICE_KINDS),
    hasUsage: boolean(row.hasUsage),
  });
}

function decodeFeature(value: unknown): PricingFeature {
  const row = record(value);
  return Object.freeze({
    feature: string(row.feature),
    name: string(row.name),
    kind: oneOf(row.kind, FEATURE_KINDS),
    allowance: nullableNonnegativeInteger(row.allowance),
    resetInterval: row.resetInterval === null ? null : oneOf(row.resetInterval, INTERVALS),
  });
}

function decodeSubscription(value: unknown): BillingSubscription | null {
  if (value === null) return null;
  const row = record(value);
  return Object.freeze({
    productId: string(row.productId),
    status: string(row.status),
    currentPeriodEnd: nullableString(row.currentPeriodEnd),
    cancelAtPeriodEnd: boolean(row.cancelAtPeriodEnd),
  });
}

function decodeEntitlement(value: unknown): EntitlementView {
  const row = record(value);
  return Object.freeze({
    feature: string(row.feature),
    kind: string(row.kind),
    allowed: boolean(row.allowed),
    balance: nullableNumber(row.balance),
  });
}

function decodeSubject(value: unknown): BillingSubject | null {
  if (value === null) return null;
  const row = record(value);
  return Object.freeze({
    type: oneOf(row.type, BILLING_SUBJECT_TYPES),
    id: string(row.id),
  });
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  const result = string(value);
  if (!(allowed as readonly string[]).includes(result)) invalid();
  return result as T[number];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return string(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}

function boundedNonnegativeInteger(value: unknown, maximum: number): number {
  const result = nonnegativeInteger(value);
  if (result > maximum) invalid();
  return result;
}

function nullableNonnegativeInteger(value: unknown): number | null {
  if (value === null) return null;
  return nonnegativeInteger(value);
}

function positiveInteger(value: unknown): number {
  const result = nonnegativeInteger(value);
  if (result === 0) invalid();
  return result;
}

function isCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function currency(value: unknown): string {
  const result = string(value);
  if (!isCurrency(result)) invalid();
  return result;
}

function nullableCurrency(value: unknown): string | null {
  if (value === null) return null;
  return currency(value);
}

function safeWebUrl(value: unknown): string {
  const result = string(value);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    return invalid();
  }
  if (parsed.protocol !== 'https:'
    && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) invalid();
  return result;
}

function invalid(): never {
  throw new TypeError('Invalid billing response.');
}
