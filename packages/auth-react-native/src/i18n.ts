/**
 * Localization for the React Native components.
 *
 * Reads the SAME catalogs the web components use (`@authowl/core/i18n`). That
 * is a hard rule, not a convenience: a second catalog is how an Arabic string
 * silently stops matching between the web app and the phone app.
 */

import { useMemo } from 'react';
import {
  directionFor,
  formatMessage,
  resolveServerError,
  type Locale,
  type MessageKey,
  type MessageParams,
  type ServerErrorInput,
} from '@authowl/core/i18n';

import { useAuthOwlLocale } from './provider';

/** Translate a catalog key in the active locale. */
export function useT(): (key: MessageKey, params?: MessageParams) => string {
  const locale = useAuthOwlLocale();
  return useMemo(
    () => (key: MessageKey, params?: MessageParams) => formatMessage(locale, key, params),
    [locale],
  );
}

/** The active locale and its writing direction. */
export function useLocale(): { locale: Locale; direction: 'ltr' | 'rtl' } {
  const locale = useAuthOwlLocale();
  return useMemo(() => ({ locale, direction: directionFor(locale) }), [locale]);
}

/**
 * Turn a server failure into a localized sentence.
 *
 * Falls back to the generic message rather than surfacing a raw server string:
 * an untranslated backend error in the middle of an Arabic sign-in screen is
 * both a leak and a UX failure.
 */
export function useServerError(): (
  error: ServerErrorInput | null | undefined,
  fallback: MessageKey,
) => string {
  const locale = useAuthOwlLocale();
  const t = useT();
  return useMemo(
    () => (error, fallback) => resolveServerError(locale, error, t(fallback)),
    [locale, t],
  );
}

export type { Locale, MessageKey, MessageParams };
