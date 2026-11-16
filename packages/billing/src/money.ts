import type { BillingLocale } from './i18n';

export function numberLocale(locale: BillingLocale): string {
  return locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
}

export function formatPrice(
  amount: number,
  currency: string,
  exponent: number,
  locale: BillingLocale,
): string {
  const divisor = 10 ** exponent;
  const digits = amount % divisor === 0 ? 0 : exponent;
  return new Intl.NumberFormat(numberLocale(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / divisor);
}

export function formatCount(count: number, locale: BillingLocale): string {
  return new Intl.NumberFormat(numberLocale(locale)).format(count);
}
