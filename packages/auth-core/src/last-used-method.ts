import { localStore, readFrom, writeTo } from './web-storage';

/**
 * Which sign-in method last worked IN THIS BROWSER.
 *
 * A returning user usually has one habit, and a form that shows five equal
 * options makes them re-derive it every visit. Remembering it is a small thing
 * that removes a real hesitation.
 *
 * WHY THIS IS NOT THE `last-login-method` PLUGIN. That plugin sets a
 * non-httpOnly cookie and reads it from `document.cookie`. In AuthOwl's SPA
 * architecture that cookie lands on the ENGINE's domain, invisible to the
 * tenant's page; in the server architecture it lands on the tenant server's
 * fetch, which the session bridge does not forward. Unreadable in both. The SDK
 * does not need it told anyway - it executed the call, so it already knows.
 *
 * THE LINE THIS MUST NOT CROSS. What is stored is a property of this BROWSER,
 * never of an address. Nothing here may be keyed by, derived from, or exposed
 * alongside an email or username: "which method does a@b.com use" is an account
 * enumeration and targeted-phishing surface, and answering it before
 * authentication would hand an attacker the cheapest possible reconnaissance.
 * The value is written only AFTER a method has already succeeded here, so it
 * reveals nothing that this browser did not already do.
 *
 * Best-effort storage, deliberately: a browser refusing `localStorage` degrades
 * to "no badge", which is invisible, rather than to a sign-in that throws.
 */

/**
 * The methods worth remembering, as a closed set.
 *
 * A closed set rather than a free string because this value is read back from
 * storage a user can edit, and it decides what a form highlights. An unknown
 * value is discarded rather than rendered.
 *
 * Social providers collapse to `social:<id>` so a returning Google user is
 * pointed at the Google button rather than at "social" generally.
 */
export const LAST_USED_METHODS = [
  'password',
  'username',
  'magic-link',
  'email-otp',
  'phone-otp',
  'passkey',
  'sso',
] as const;

export type LastUsedSignInMethod =
  | (typeof LAST_USED_METHODS)[number]
  | `social:${string}`;

const STORAGE_KEY_PREFIX = 'authowl.last-used-method';
/** Bounds what a hostile storage value can be, and what a provider id may look like. */
const SOCIAL_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const lastUsedMethodStorageKey = (projectId: string): string =>
  `${STORAGE_KEY_PREFIX}.${projectId}`;

function isLastUsedSignInMethod(value: string): value is LastUsedSignInMethod {
  if ((LAST_USED_METHODS as readonly string[]).includes(value)) return true;
  return value.startsWith('social:') && SOCIAL_PROVIDER_PATTERN.test(value.slice(7));
}

/**
 * Read what last worked here, or null.
 *
 * Null covers every uncertainty identically - never used, storage refused,
 * value unrecognised, value tampered with - because a caller has exactly one
 * sensible response to all of them, which is to show no badge.
 */
export function readLastUsedSignInMethod(projectId: string): LastUsedSignInMethod | null {
  const stored = readFrom(localStore(), lastUsedMethodStorageKey(projectId));
  if (stored === null || !isLastUsedSignInMethod(stored)) return null;
  return stored;
}

/**
 * Record a method that JUST SUCCEEDED.
 *
 * Never call this at the start of an attempt for a method that completes
 * in-page: a failed password attempt would then teach the form to recommend
 * the method that just did not work.
 *
 * Redirect methods are the exception and are handled by
 * `rememberPendingSignInMethod`, because the page that would record success is
 * one the browser leaves before reaching.
 */
export function recordLastUsedSignInMethod(
  projectId: string,
  method: LastUsedSignInMethod,
): void {
  if (!isLastUsedSignInMethod(method)) return;
  // An in-page method that just succeeded is stronger evidence than any
  // redirect attempt left behind by a cancelled or failed provider flow.
  writeTo(localStore(), pendingSignInMethodStorageKey(projectId), null);
  writeTo(localStore(), lastUsedMethodStorageKey(projectId), method);
}

export function forgetLastUsedSignInMethod(projectId: string): void {
  writeTo(localStore(), lastUsedMethodStorageKey(projectId), null);
}

const PENDING_KEY_PREFIX = 'authowl.last-used-method.pending';
const PENDING_MAX_AGE_MS = 15 * 60 * 1_000;

export const pendingSignInMethodStorageKey = (projectId: string): string =>
  `${PENDING_KEY_PREFIX}.${projectId}`;

/**
 * Note that a REDIRECT method is being attempted, without recording it as used.
 *
 * Social and SSO leave the page before anything can observe success, so the
 * attempt is parked here and promoted only once the user comes back signed in.
 * Kept separate from the recorded value on purpose: a user who bounces off a
 * provider's consent screen and returns unauthenticated must not be told that
 * provider is what worked last, because it did not.
 */
export function rememberPendingSignInMethod(
  projectId: string,
  method: LastUsedSignInMethod,
): void {
  if (!isLastUsedSignInMethod(method)) return;
  writeTo(
    localStore(),
    pendingSignInMethodStorageKey(projectId),
    JSON.stringify({ method, createdAt: Date.now() }),
  );
}

/** Clear a redirect attempt that failed before navigation completed. */
export function forgetPendingSignInMethod(projectId: string): void {
  writeTo(localStore(), pendingSignInMethodStorageKey(projectId), null);
}

/**
 * Promote a parked redirect attempt now that a session exists, and clear it.
 *
 * Call only with a confirmed session. Returns what was promoted, or null.
 */
export function confirmPendingSignInMethod(
  projectId: string,
): LastUsedSignInMethod | null {
  const pending = readFrom(localStore(), pendingSignInMethodStorageKey(projectId));
  writeTo(localStore(), pendingSignInMethodStorageKey(projectId), null);
  if (pending === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(pending);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('method' in parsed)
    || !('createdAt' in parsed)
    || typeof parsed.method !== 'string'
    || typeof parsed.createdAt !== 'number'
    || !isLastUsedSignInMethod(parsed.method)
    || !Number.isFinite(parsed.createdAt)
    || parsed.createdAt > Date.now()
    || Date.now() - parsed.createdAt > PENDING_MAX_AGE_MS
  ) return null;
  recordLastUsedSignInMethod(projectId, parsed.method);
  return parsed.method;
}
