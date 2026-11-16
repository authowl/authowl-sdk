import { describe, expect, it } from 'vitest';
import {
  checkoutRedirect,
  portalRedirect,
  pricingCatalog,
} from '../../examples/vite-react/src/preview-billing-fixtures';
import {
  decodeCheckoutResult,
  decodePortalResult,
  decodePricingCatalog,
} from '../../packages/billing/src/wire';

describe('billing preview wire fixtures', () => {
  it.each(['one', 'three', 'five', 'mixed', 'empty'] as const)(
    'decodes the %s pricing catalog',
    (fixture) => {
      const wireBody: unknown = JSON.parse(JSON.stringify(pricingCatalog(fixture)));
      expect(decodePricingCatalog(wireBody).status).toBe('ok');
    },
  );

  it('decodes the checkout redirect', () => {
    const wireBody: unknown = JSON.parse(JSON.stringify(checkoutRedirect()));
    expect(decodeCheckoutResult(wireBody)).toMatchObject({
      status: 'redirect', productId: 'starter', currency: 'EGP',
    });
  });

  it('decodes the portal redirect', () => {
    const wireBody: unknown = JSON.parse(JSON.stringify(portalRedirect()));
    expect(decodePortalResult(wireBody).status).toBe('redirect');
  });
});
