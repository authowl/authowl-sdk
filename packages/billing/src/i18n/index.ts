import type { BillingMessageKey } from './en';
import { billingMessageKeys, billingMessages } from './runtime';

export type BillingLocale = 'en' | 'ar';
export type BillingMessageValues = Readonly<Record<string, string | number>>;

export function billingMessage(
  locale: BillingLocale,
  key: BillingMessageKey,
  values: BillingMessageValues = {},
): string {
  const index = billingMessageKeys.indexOf(key);
  const template = billingMessages[locale][index]!;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ''));
}

export type { BillingMessageKey };
