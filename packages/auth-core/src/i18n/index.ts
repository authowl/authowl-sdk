/**
 * Locale primitives shared across packages (plan 04, B.3). Deliberately tiny:
 * the message CATALOGS live in @authowl/react (they are component strings -
 * headless @authowl/core consumers shouldn't ship ~5kb of UI copy), while the
 * locale identity/direction helpers here are needed by anything that reads
 * public-config `locale` or renders direction-aware UI.
 */
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Text direction for a locale - drives the `dir` attribute on the component root. */
export function directionFor(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Narrow an arbitrary string (e.g. public-config `locale`) to a supported Locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
