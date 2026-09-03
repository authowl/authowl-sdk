import { localStore, readFrom, writeTo } from './web-storage';

/**
 * Whether this browser should still be offered a passkey after signing in.
 *
 * The offer is worth making once and then leaving alone. Asking on every
 * sign-in is nagging, and a user who declined twice has answered. So the
 * decision is remembered per project, per browser.
 *
 * KEYED PER PROJECT **AND PER USER**. Per project alone looked tidier and was
 * wrong: on a shared or family device the first person to answer silenced the
 * offer for everyone after them - permanently if they enrolled, because the
 * due-check short-circuits before the server is ever consulted. An answer is a
 * property of the person who gave it.
 *
 * THE SAME LINE AS `last-used-method`: what is stored is a property of this
 * BROWSER, never of an ADDRESS. The user id is an opaque identifier the client
 * already holds for a signed-in session - it is not an email or a username, and
 * nothing here may be keyed by, derived from, or exposed alongside one. Nothing
 * is written until the user is already signed in, so it reveals nothing this
 * browser did not do.
 *
 * It is a HINT, not a record of truth. A passkey added on another device, or
 * through the account page, is invisible here - which is why the caller also
 * asks the server before offering. Storage refusing to work degrades to "ask
 * again next time", never to a broken sign-in.
 */

const STORAGE_KEY_PREFIX = 'authowl.passkey-offer';

/**
 * Enrolled from the offer on this browser: never ask again.
 *
 * A dismissal in a second tab can overwrite this, and that is harmless: once
 * the passkey exists the SERVER's list is non-empty, and the caller checks it
 * before storage is ever consulted. Storage only ever suppresses an offer the
 * server would otherwise allow; it cannot resurrect one.
 */
const SETTLED = 'done';

/**
 * How long a dismissal lasts. Long enough not to nag, short enough that someone
 * who declined while busy is asked once more in a different frame of mind.
 */
const DISMISSAL_COOL_OFF_MS = 30 * 24 * 60 * 60 * 1000;

export const passkeyOfferStorageKey = (projectId: string, userId: string): string =>
  `${STORAGE_KEY_PREFIX}.${projectId}.${userId}`;

/**
 * True when the offer may be shown.
 *
 * Every uncertainty answers the same way - never asked, storage refused, a
 * value that is not ours - because the sensible response to all of them is to
 * ask, which is recoverable. The only values that suppress it are ones this
 * module wrote.
 */
export function passkeyOfferIsDue(
  projectId: string,
  userId: string,
  now: number = Date.now(),
): boolean {
  const stored = readFrom(localStore(), passkeyOfferStorageKey(projectId, userId));
  if (stored === null) return true;
  if (stored === SETTLED) return false;
  const dismissedAt = Number(stored);
  // A tampered or garbage value is treated as "never asked" rather than as a
  // permanent suppression: a hostile storage entry must not be able to switch
  // the offer off forever.
  if (!Number.isFinite(dismissedAt)) return true;
  // Bounded at both ends. A future-dated stamp would otherwise suppress the
  // offer indefinitely instead of for the cool-off.
  const elapsed = now - dismissedAt;
  return elapsed < 0 || elapsed >= DISMISSAL_COOL_OFF_MS;
}

/** The user declined. Ask again after the cool-off. */
export function recordPasskeyOfferDismissed(
  projectId: string,
  userId: string,
  now: number = Date.now(),
): void {
  writeTo(localStore(), passkeyOfferStorageKey(projectId, userId), String(now));
}

/** A passkey now exists because of the offer. Stop asking on this browser. */
export function recordPasskeyOfferSettled(projectId: string, userId: string): void {
  writeTo(localStore(), passkeyOfferStorageKey(projectId, userId), SETTLED);
}
