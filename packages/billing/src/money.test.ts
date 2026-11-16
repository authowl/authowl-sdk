import { describe, expect, it } from 'vitest';
import { formatCount, formatPrice } from './money';

describe('billing money', () => {
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
