export type PreviewPricing = 'one' | 'three' | 'five' | 'mixed' | 'loading' | 'empty' | 'error';
export type PreviewCommerce = 'loading' | 'error' | 'redirect';

const pricingProducts = [
  {
    id: 'starter', name: 'Starter',
    prices: [
      { currency: 'EGP', amount: 19000, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false },
      { currency: 'USD', amount: 900, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false },
    ],
    features: [{ feature: 'projects', name: 'Projects', kind: 'metered', allowance: 3, resetInterval: null }],
  },
  {
    id: 'growth', name: 'Growth',
    prices: [
      { currency: 'EGP', amount: 49000, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: true },
      { currency: 'USD', amount: 1900, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: true },
    ],
    features: [
      { feature: 'projects', name: 'Projects', kind: 'metered', allowance: 25, resetInterval: null },
      { feature: 'analytics', name: 'Analytics', kind: 'boolean', allowance: null, resetInterval: null },
    ],
  },
  {
    id: 'scale', name: 'Scale',
    prices: [
      { currency: 'EGP', amount: 99000, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false },
      { currency: 'USD', amount: 3900, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false },
    ],
    features: [{ feature: 'projects', name: 'Projects', kind: 'metered', allowance: null, resetInterval: 'month' }],
  },
  {
    id: 'business', name: 'Business',
    prices: [{ currency: 'EGP', amount: 149000, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false }],
    features: [{ feature: 'support', name: 'Priority support', kind: 'boolean', allowance: null, resetInterval: null }],
  },
  {
    id: 'enterprise', name: 'Enterprise',
    prices: [{ currency: 'EGP', amount: 249000, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false }],
    features: [{ feature: 'seats', name: 'Seats', kind: 'metered', allowance: 100, resetInterval: 'month' }],
  },
] as const;

export function pricingCatalog(fixture: Exclude<PreviewPricing, 'loading' | 'error'>) {
  const count = fixture === 'one' ? 1 : fixture === 'three' || fixture === 'mixed' ? 3 : fixture === 'empty' ? 0 : 5;
  const products = pricingProducts.slice(0, count).map((product, index) => fixture === 'mixed' && index === 2
    ? { ...product, prices: product.prices.filter((price) => price.currency !== 'USD') }
    : product);
  return {
    status: 'ok', environment: 'sandbox', customerType: 'organization',
    defaultCurrency: 'EGP', currencies: ['EGP', 'USD'],
    providers: { EGP: 'paymob', USD: 'stripe' }, products,
  };
}

export function checkoutRedirect() {
  return {
    status: 'redirect', url: 'https://payments.preview.test/session',
    productId: 'starter', currency: 'EGP', expiresAt: '2026-07-14T09:00:00.000Z',
  };
}

export function portalRedirect() {
  return {
    status: 'redirect', url: 'https://portal.preview.test/session',
    expiresAt: '2026-07-14T09:00:00.000Z',
  };
}
