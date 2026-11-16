// @vitest-environment jsdom
import type { AuthOwlClient } from '@authowl/core';
import { act } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePricing } from './react';
import { makeCore, ok, settle } from './test-fixtures';

let currentCore: AuthOwlClient;

vi.mock('@authowl/react', () => ({
  useAuthClient: () => currentCore,
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user-test' }),
  useAuthOwlContext: () => ({ appearance: undefined }),
  useLocale: () => 'en',
  slot: (name: string) => `ao-${name}`,
}));

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
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
});
