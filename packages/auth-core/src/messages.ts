/**
 * Localized user-facing strings, as a SEPARATE entry point.
 *
 * These live in core rather than in `@authowl/react` because every UI the SDK
 * ships must show the same wording: the React components, the React Native
 * components, and anything a consumer builds on the headless clients. Keeping
 * one catalog is a hard rule - duplicating strings per platform is how an
 * Arabic translation silently stops matching between web and mobile.
 *
 * They are NOT re-exported from `@authowl/core`'s main entry. The two catalogs
 * are tens of kilobytes of text, and the framework-neutral client has a bundle
 * budget it must not spend on strings a headless consumer never renders. A
 * separate entry keeps that payload opt-in:
 *
 *     import { formatMessage } from '@authowl/core/i18n';
 */

export {
  catalogs,
  formatMessage,
  formatRetryDuration,
  resolveServerError,
  serverErrorMessage,
  type MessageCatalog,
  type MessageKey,
  type MessageParams,
  type ServerErrorInput,
} from './i18n/catalog';
export { LOCALES, directionFor, isLocale, type Locale } from './i18n';
