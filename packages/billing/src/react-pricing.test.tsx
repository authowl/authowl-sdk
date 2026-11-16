// @vitest-environment jsdom
import type { AuthOwlClient } from '@authowl/core';
import { act } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutButton, PricingTable, usePricing } from './react-commerce';
import { ALLOWED_LIST, makeCore, ok, settle } from './test-fixtures';

let currentCore: AuthOwlClient;
let currentLocale: 'en' | 'ar' = 'en';
let currentSignedIn = true;

vi.mock('@authowl/react', () => ({
  useAuthClient: () => currentCore,
  useAuth: () => ({ isLoaded: true, isSignedIn: currentSignedIn, userId: currentSignedIn ? 'user-test' : null }),
  useAuthOwlContext: () => ({ appearance: undefined }),
  useLocale: () => currentLocale,
  slot: (name: string) => `ao-${name}`,
}));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  currentLocale = 'en';
  currentSignedIn = true;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const catalog = {
  status: 'ok', environment: 'sandbox', customerType: 'user', defaultCurrency: 'USD',
  currencies: ['USD', 'EGP'], providers: { USD: 'stripe', EGP: 'paymob' },
  products: [
    { id: 'hidden', name: 'Hidden', prices: [{ currency: 'EGP', amount: 100, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false }], features: [] },
    { id: 'z', name: 'Zed', prices: [{ currency: 'USD', amount: 900, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false }], features: [] },
    { id: 'a', name: 'Alpha', prices: [{ currency: 'USD', amount: 500, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false }], features: [] },
  ],
};

const componentCatalog = {
  status: 'ok', environment: 'sandbox', customerType: 'organization', defaultCurrency: 'EGP',
  currencies: ['EGP'], providers: { EGP: 'paymob' },
  products: [
    {
      id: 'a', name: 'Alpha',
      prices: [{ currency: 'EGP', amount: 900, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false }],
      features: [],
    },
    {
      id: 'metered', name: 'Metered',
      prices: [{ currency: 'EGP', amount: 19000, exponent: 2, interval: 'month', intervalCount: 1, kind: 'fixed_recurring', hasUsage: false }],
      features: [{ feature: 'seats', name: 'Seats', kind: 'metered', allowance: 100, resetInterval: 'month' }],
    },
  ],
};

function Probe({ currency }: { currency?: string }) {
  const pricing = usePricing({ currency });
  return <output data-status={pricing.status}>{pricing.products.map((product) => `${product.name}:${product.prices[0]!.currency}`).join('|')}</output>;
}

describe('billing pricing React hook', () => {
  it('filters hidden currencies and sorts by amount', async () => {
    currentCore = makeCore({ handler: async (path) => path.endsWith('/products') ? ok(catalog) : ok({}) }).core;
    const view = render(<Probe />);
    await act(async () => settle());
    expect(view.container.textContent).toBe('Alpha:USD|Zed:USD');
    expect(view.container.textContent).not.toContain('EGP');
    expect(view.getByRole('status', { hidden: true })).toBeDefined();
  });

  it('honors an invalid controlled currency with the empty state', async () => {
    currentCore = makeCore({ handler: async (path) => path.endsWith('/products') ? ok(catalog) : ok({}) }).core;
    const view = render(<Probe currency="KWD" />);
    await act(async () => settle());
    expect(view.container.querySelector('output')?.getAttribute('data-status')).toBe('empty');
    expect(view.container.textContent).toBe('');
  });

  it('keeps a previous catalog ready while a stale refresh is pending', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let productReads = 0;
    let resolveRefresh!: (value: { status: number; body?: unknown }) => void;
    const pending = new Promise<{ status: number; body?: unknown }>((resolve) => {
      resolveRefresh = resolve;
    });
    const fixture = makeCore({ handler: async (path) => {
      if (!path.endsWith('/products')) return ok(ALLOWED_LIST);
      productReads += 1;
      return productReads === 1 ? ok(catalog) : pending;
    } });
    currentCore = fixture.core;
    const first = render(<Probe />);
    await act(async () => settle());
    expect(first.container.querySelector('output')?.getAttribute('data-status')).toBe('ready');
    now += 300_001;
    const second = render(<Probe />);
    await act(async () => settle());
    expect(first.container.querySelector('output')?.getAttribute('data-status')).toBe('ready');
    expect(second.container.querySelector('output')?.getAttribute('data-status')).toBe('ready');
    resolveRefresh({ status: 500 });
    await act(async () => settle());
    expect(first.container.querySelector('output')?.getAttribute('data-status')).toBe('ready');
    expect(second.container.querySelector('output')?.getAttribute('data-status')).toBe('ready');
  });
});

describe('billing pricing components', () => {
  it.each(['canceled', 'incomplete', 'incomplete_expired'])(
    'offers Subscribe and no current badge for a %s subscription',
    async (status) => {
      currentCore = componentCore(subscription(status, 'a'));
      const view = render(<PricingTable productIds={['a']} />);
      await act(async () => settle());
      expect((view.getByRole('button', { name: 'Subscribe to Alpha' }) as HTMLButtonElement).disabled).toBe(false);
      expect(view.queryByText('Current plan')).toBeNull();
    },
  );

  it.each(['past_due', 'future_status'])(
    'treats %s as live and offers the portal for every plan',
    async (status) => {
      currentCore = componentCore(subscription(status, 'a'));
      const view = render(<PricingTable />);
      await act(async () => settle());
      expect(view.getByText('Current plan')).toBeDefined();
      expect(view.getAllByRole('button', { name: 'Manage subscription' })).toHaveLength(2);
      expect(view.queryByRole('button', { name: /Subscribe to/ })).toBeNull();
      expect(view.getAllByText('Opens your billing portal, hosted by Billow.')).toHaveLength(2);
      expect(view.queryByText(/secure page hosted by/)).toBeNull();
    },
  );

  it('uses any live subscription to turn a standalone checkout into a portal action', async () => {
    currentCore = componentCore(subscription('active', 'other'));
    const view = render(<CheckoutButton productId="a" />);
    await act(async () => settle());
    expect((view.getByRole('button', { name: 'Manage subscription: Alpha' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders Free, a custom CTA, signed-out state, role hint and truthful disclosures', async () => {
    currentCore = componentCore({ ...ALLOWED_LIST, canManage: false }, {
      ...catalog,
      products: [{
        ...catalog.products[2]!,
        id: 'free',
        name: 'Free plan',
        prices: [{ ...catalog.products[2]!.prices[0]!, amount: 0 }],
      }],
    });
    const role = render(<PricingTable />);
    await act(async () => settle());
    expect(role.getByText('Free')).toBeDefined();
    expect(role.getByText('Ask an admin of your organization to manage billing.')).toBeDefined();
    expect(role.queryByText(/secure page hosted by/)).toBeNull();
    role.unmount();

    currentCore = componentCore(ALLOWED_LIST);
    const custom = render(<PricingTable productIds={['a']} cta={{ a: { label: 'Contact sales', href: '/sales' } }} />);
    await act(async () => settle());
    expect(custom.getByRole('link', { name: 'Contact sales: Alpha' }).getAttribute('href')).toBe('/sales');
    expect(custom.queryByText(/secure page hosted by/)).toBeNull();
    custom.unmount();

    currentSignedIn = false;
    currentCore = componentCore(ALLOWED_LIST);
    const signedOut = render(<PricingTable productIds={['a']} signInUrl="/sign-in" />);
    await act(async () => settle());
    expect(signedOut.getByRole('link', { name: 'Sign in to subscribe: Alpha' })).toBeDefined();
  });

  it.each([
    ['en', 'Seats: 100 per month'],
    ['ar', 'Seats: 100 شهريًا'],
  ] as const)('localizes metered intervals and keeps Latin digits in %s', async (locale, expected) => {
    currentLocale = locale;
    currentCore = componentCore(ALLOWED_LIST);
    const view = render(<PricingTable productIds={['metered']} />);
    await act(async () => settle());
    expect(view.getByText(expected)).toBeDefined();
    expect(view.container.textContent).not.toMatch(/[٠-٩۰-۹]/);
    expect(view.getByText(/EGP.*190|190.*EGP/).textContent).toMatch(/[0-9]/);
    expect(view.getByText(/secure page hosted by Paymob|صفحة آمنة تستضيفها Paymob/)).toBeDefined();
  });

  it('uses unique heading ids when two tables render on one page', async () => {
    currentCore = componentCore(ALLOWED_LIST);
    const view = render(<><PricingTable productIds={['a']} /><PricingTable productIds={['a']} /></>);
    await act(async () => settle());
    const ids = [...view.container.querySelectorAll('h2')].map((heading) => heading.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps a custom visible checkout label in the accessible name', async () => {
    currentCore = componentCore(ALLOWED_LIST);
    const view = render(<CheckoutButton productId="a">Choose Alpha</CheckoutButton>);
    await act(async () => settle());
    expect((view.getByRole('button', { name: 'Choose Alpha' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

function subscription(status: string, productId: string) {
  return {
    ...ALLOWED_LIST,
    subscription: { productId, status, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  };
}

function componentCore(entitlements: object, pricing: object = componentCatalog) {
  return makeCore({ handler: async (path) => {
    if (path.endsWith('/products')) return ok(pricing);
    if (path.endsWith('/entitlements')) return ok(entitlements);
    return ok({ status: 'not_connected' });
  } }).core;
}
