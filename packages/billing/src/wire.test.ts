import { describe, expect, it } from 'vitest';
import {
  decodeCheckoutResult,
  decodeEntitlementList,
  decodePortalResult,
  decodePricingCatalog,
} from './wire';

const PRICE = {
  currency: 'USD',
  amount: 2_500,
  exponent: 2,
  interval: 'month',
  intervalCount: 1,
  kind: 'fixed_recurring',
  hasUsage: false,
};
const FEATURE = {
  feature: 'reports',
  name: 'Reports',
  kind: 'boolean',
  allowance: null,
  resetInterval: null,
};
const PRODUCT = {
  id: 'pro',
  name: 'Pro',
  prices: [PRICE],
  features: [FEATURE],
};
const CATALOG = {
  status: 'ok',
  environment: 'sandbox',
  customerType: 'user',
  defaultCurrency: 'USD',
  currencies: ['USD'],
  providers: { USD: 'stripe' },
  products: [PRODUCT],
};

describe('billing wire decoders', () => {
  it('decodes the catalog allowlist and drops unknown fields at every level', () => {
    const value = decodePricingCatalog({
      ...CATALOG,
      secret: 'drop',
      products: [{
        ...PRODUCT,
        internal: 'drop',
        prices: [{ ...PRICE, providerPriceId: 'drop' }],
        features: [{ ...FEATURE, rollover: true }],
      }],
    });
    expect(value).toEqual(CATALOG);
    expect(Object.keys(value)).toEqual([
      'status',
      'environment',
      'customerType',
      'defaultCurrency',
      'currencies',
      'providers',
      'products',
    ]);
    expect(Object.keys(value.products[0]!)).toEqual(['id', 'name', 'prices', 'features']);
  });

  it.each([
    ['catalog status', { ...CATALOG, status: 'future' }],
    ['environment', { ...CATALOG, environment: 'preview' }],
    ['customer type', { ...CATALOG, customerType: 'team' }],
    ['currency', { ...CATALOG, currencies: ['usd'] }],
    ['provider', { ...CATALOG, providers: { USD: 'Stripe Inc.' } }],
    ['price kind', { ...CATALOG, products: [{ ...PRODUCT, prices: [{ ...PRICE, kind: 'usage' }] }] }],
    ['interval', { ...CATALOG, products: [{ ...PRODUCT, prices: [{ ...PRICE, interval: 'quarter' }] }] }],
    ['feature kind', { ...CATALOG, products: [{ ...PRODUCT, features: [{ ...FEATURE, kind: 'future' }] }] }],
  ])('rejects an unknown %s', (_name, value) => {
    expect(() => decodePricingCatalog(value)).toThrow('Invalid billing response.');
  });

  it('enforces the server product and feature caps', () => {
    expect(() => decodePricingCatalog({
      ...CATALOG,
      products: Array.from({ length: 51 }, () => PRODUCT),
    })).toThrow('Invalid billing response.');
    expect(() => decodePricingCatalog({
      ...CATALOG,
      products: [{
        ...PRODUCT,
        features: Array.from({ length: 31 }, () => FEATURE),
      }],
    })).toThrow('Invalid billing response.');
  });

  it.each([
    { status: 'redirect', url: 'https://checkout.example.test/pay', productId: 'pro', currency: 'USD', expiresAt: '2026-11-16T12:00:00.000Z' },
    { status: 'redirect', url: 'http://localhost:3000/pay', productId: 'pro', currency: 'USD', expiresAt: '2026-11-16T12:00:00.000Z' },
    { status: 'active', productId: 'pro' },
    { status: 'pending', retryAfterSeconds: 3 },
    { status: 'checkout_open', productId: 'pro', currency: 'EGP', expiresAt: '2026-11-16T12:00:00.000Z' },
    { status: 'already_subscribed', productId: 'starter' },
    { status: 'product_unavailable' },
    { status: 'checkout_unavailable' },
    { status: 'not_connected' },
    { status: 'no_organization' },
    { status: 'role_required' },
    { status: 'erased' },
  ])('decodes checkout status $status', (value) => {
    expect(decodeCheckoutResult({ ...value, ignored: 'drop' })).toEqual(value);
  });

  it.each([
    'javascript:alert(1)',
    'http://example.test/pay',
    '/relative',
  ])('rejects checkout redirect URL %s', (url) => {
    expect(() => decodeCheckoutResult({
      status: 'redirect',
      url,
      productId: 'pro',
      currency: 'USD',
      expiresAt: '2026-11-16T12:00:00.000Z',
    })).toThrow('Invalid billing response.');
  });

  it.each([
    { status: 'redirect', url: 'https://billing.example.test/s/token', expiresAt: '2026-11-16T12:00:00.000Z' },
    { status: 'not_connected' },
    { status: 'no_organization' },
    { status: 'role_required' },
    { status: 'no_customer' },
    { status: 'erased' },
  ])('decodes portal status $status', (value) => {
    expect(decodePortalResult({ ...value, ignored: 'drop' })).toEqual(value);
  });

  it('defaults entitlement commerce fields only when an older server omits them', () => {
    const base = {
      status: 'ok',
      subject: { type: 'user', id: 'user-1' },
      source: 'snapshot',
      fetchedAt: '2026-11-16T12:00:00.000Z',
      entitlements: [],
    };
    expect(decodeEntitlementList(base)).toMatchObject({
      subscription: null,
      canManage: false,
    });
    expect(decodeEntitlementList({
      ...base,
      subscription: {
        productId: 'pro',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      canManage: true,
    })).toMatchObject({
      subscription: { productId: 'pro', status: 'active' },
      canManage: true,
    });
  });
});
