import { describe, expect, it } from 'vitest';
import { LOCALES, directionFor, isLocale } from './index';

describe('locale primitives', () => {
  it('directionFor: ar is rtl, en is ltr', () => {
    expect(directionFor('ar')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
  });

  it('isLocale narrows only supported locales', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(1)).toBe(false);
  });
});
