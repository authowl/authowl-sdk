import type { Locale } from './index';
import { en } from './en';
import { ar } from './ar';

/**
 * The component message catalogs + `{param}` formatter (plan 04, B.3). Lives
 * in @authowl/react (not core) on purpose: these are component strings, and
 * headless core consumers shouldn't ship them. Locale identity/direction
 * primitives (`Locale`, `directionFor`, `isLocale`) come from @authowl/core.
 */
export type MessageKey = keyof typeof en;
export type MessageCatalog = Record<MessageKey, string>;

export const catalogs: Record<Locale, MessageCatalog> = { en, ar };

export type MessageParams = Record<string, string | number>;

/**
 * Look up `key` in the locale's catalog and substitute `{param}` tokens.
 * Unknown params are left as-is (visible in review rather than silently
 * dropped); key presence is compile-time guaranteed by MessageCatalog.
 */
export function formatMessage(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const message = catalogs[locale][key];
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (token, name: string) =>
    name in params ? String(params[name]) : token,
  );
}

/**
 * Localized message for a server error `code` (the RFC7807 `code` the server
 * sends - CONTRACTS §3), or null when the code has no catalog entry. Callers
 * that want the full display policy (retry-aware copy + a server-message
 * fallback tier) use {@link resolveServerError} instead of this raw lookup.
 */
export function serverErrorMessage(locale: Locale, code: string | undefined | null): string | null {
  if (!code) return null;
  const key = `serverError.${code}`;
  return key in catalogs[locale] ? catalogs[locale][key as MessageKey] : null;
}

/** The subset of an `AuthClientError` the display policy reads. */
export interface ServerErrorInput {
  code?: string;
  status?: number;
  statusText?: string;
  message?: string;
  retryAfterSeconds?: number;
}

/** Rate-limit / lockout codes that carry a duration-aware `.retryIn` variant. */
const RETRY_FAMILY = new Set(['RATE_LIMITED', 'TOO_MANY_ATTEMPTS', 'ACCOUNT_TEMPORARILY_LOCKED']);

/**
 * Enumeration denylist: unmapped codes whose server `message` must NOT be shown
 * by the fallback tier, so the neutral flows (forgot-password / magic-link) stay
 * silent about which emails have accounts. They keep the caller's generic copy.
 */
const ENUMERATION_DENYLIST = new Set([
  'USER_NOT_FOUND',
  'USER_EMAIL_NOT_FOUND',
  'ACCOUNT_NOT_FOUND',
  'CREDENTIAL_ACCOUNT_NOT_FOUND',
]);

/** Blob guard: never surface a server `message` longer than this. */
const MAX_SERVER_MESSAGE_LENGTH = 200;

/**
 * Format a retry wait as a localized `{duration}` for the `.retryIn` strings.
 * >= 90s rounds up to whole minutes, else whole seconds; `Intl.NumberFormat`'s
 * unit style gives correct English AND Arabic plural/dual forms with no plural
 * engine and no extra dependency (no CLDR tables in the bundle).
 */
export function formatRetryDuration(locale: Locale, seconds: number): string {
  const safe = Math.max(1, Math.trunc(seconds));
  const useMinutes = safe >= 90;
  const value = useMinutes ? Math.ceil(safe / 60) : safe;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: useMinutes ? 'minute' : 'second',
    unitDisplay: 'long',
  }).format(value);
}

/**
 * THE server-error display policy (CONTRACTS §3), in one pure function so the
 * useServerError hook and its tests share a single code path:
 *
 * 1. Localize by the server error CODE (a bare 429 -> RATE_LIMITED). For the
 *    rate-limit family, a present `retryAfterSeconds` renders the duration-aware
 *    `.retryIn` variant; otherwise the static mapped copy.
 * 2. Unmapped code but a real 4xx body `message` -> show the server message,
 *    gated (see {@link canSurfaceServerMessage}) so synthesized filler, 5xx
 *    internals, over-long blobs, and enumeration-sensitive codes never leak.
 * 3. Otherwise the caller's already-localized generic `fallback`.
 */
export function resolveServerError(
  locale: Locale,
  error: ServerErrorInput | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  const code = error.code ?? (error.status === 429 ? 'RATE_LIMITED' : undefined);

  if (code && RETRY_FAMILY.has(code) && isRetryAfter(error.retryAfterSeconds)) {
    const retryKey = `serverError.${code}.retryIn`;
    if (retryKey in catalogs[locale]) {
      return formatMessage(locale, retryKey as MessageKey, {
        duration: formatRetryDuration(locale, error.retryAfterSeconds),
      });
    }
  }

  const mapped = serverErrorMessage(locale, code);
  if (mapped !== null) return mapped;

  if (canSurfaceServerMessage(error, code)) return error.message!.trim();

  return fallback;
}

function isRetryAfter(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Whether an unmapped error's raw server `message` is safe to display. */
function canSurfaceServerMessage(error: ServerErrorInput, code: string | undefined): boolean {
  if (code && ENUMERATION_DENYLIST.has(code)) return false;
  const status = error.status;
  if (typeof status !== 'number' || status < 400 || status > 499) return false;
  const message = error.message?.trim();
  if (!message || message.length > MAX_SERVER_MESSAGE_LENGTH) return false;
  // Exclude core's synthesized filler (a statusText echo, or the literal
  // "Request failed" it uses when statusText is empty) - not a server string.
  if (message === error.statusText?.trim() || message === 'Request failed') return false;
  return true;
}
