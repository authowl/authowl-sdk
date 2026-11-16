import { describe, expect, it } from 'vitest';
import { ar } from './i18n/ar';
import { en } from './i18n/en';
import { billingMessageKeys, billingMessages } from './i18n/runtime';
import { formatCount, formatPrice } from './money';

describe('billing money and catalogs', () => {
  it('keeps runtime catalogs aligned with the typed source catalogs', () => {
    expect(billingMessageKeys.map((key, index) => [key, billingMessages.en[index]]))
      .toEqual(Object.entries(en));
    expect(billingMessageKeys.map((key, index) => [key, billingMessages.ar[index]]))
      .toEqual(Object.entries(ar));
  });

  it('uses the server exponent and unambiguous currency code', () => {
    expect(formatPrice(12345, 'EGP', 2, 'en')).toContain('EGP');
    expect(formatPrice(12345, 'EGP', 2, 'en')).toContain('123.45');
    expect(formatPrice(100, 'USD', 2, 'en')).not.toContain('.00');
  });

  it('uses Latin digits for Arabic prices and counts', () => {
    const values = [formatPrice(12345, 'EGP', 2, 'ar'), formatCount(2026, 'ar')];
    expect(values.join('')).not.toMatch(/[٠-٩۰-۹]/);
    expect(values.join('')).toMatch(/[0-9]/);
  });
});
