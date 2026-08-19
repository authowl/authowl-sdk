import { localStore, readFrom, writeTo } from './web-storage';

/**
 * The organization invitation an emailed link is asking this browser to accept.
 *
 * The link lands on the TENANT'S OWN page carrying `?authowl_invitation=<id>`,
 * and the only route that can redeem it needs a session the visitor usually does
 * not have yet. So the id has to survive an entire sign-up or sign-in - which
 * means surviving that flow's redirects: the OAuth round trip, the email
 * verification round trip (which can land on a different page entirely), the MFA
 * hold, and whatever navigation the operator's own `redirectTo` performs. A query
 * parameter survives none of those, so it is read once, moved into storage, and
 * taken out of the URL.
 *
 * Best-effort storage, deliberately: a browser that refuses `localStorage`
 * degrades to "this invitation is claimable until you navigate", which is worse
 * than the ideal and much better than a sign-in that throws.
 */

export const INVITATION_QUERY_PARAM = 'authowl_invitation';
const CLAIM_KEY = 'authowl.invitation-claim';

/**
 * Ids are opaque to us, so the only thing worth asserting is that a hostile or
 * accidental value cannot become an unbounded storage write or a strange request
 * path. The engine issues uuids; this admits the same shape a little loosely
 * rather than pinning a format the server owns.
 */
const CLAIM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type InvitationClaim = {
  id: string;
  /** Epoch milliseconds, for age display and for expiring a forgotten claim. */
  capturedAt: number;
};

/** Claims older than this are dropped unread: a month-old link is not a pending intent. */
export const INVITATION_CLAIM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Read `?authowl_invitation` once, stash it, and strip it from the URL.
 *
 * Namespaced and only ours - a bare `invitation` belongs to the tenant's app as
 * much as to us, and rewriting their parameters is not ours to do. Returns the
 * captured claim, or the one already stashed when there is no parameter, so a
 * caller can render from a single call.
 */
export function captureInvitationClaim(now: number = Date.now()): InvitationClaim | null {
  if (typeof window === 'undefined') return readInvitationClaim(now);
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return readInvitationClaim(now);
  }
  const requested = url.searchParams.get(INVITATION_QUERY_PARAM);
  if (requested === null) return readInvitationClaim(now);
  url.searchParams.delete(INVITATION_QUERY_PARAM);
  try {
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // A page that refuses history rewriting still gets the claim below.
  }
  if (!CLAIM_ID_PATTERN.test(requested)) return readInvitationClaim(now);
  const claim: InvitationClaim = { id: requested, capturedAt: now };
  writeTo(localStore(), CLAIM_KEY, JSON.stringify(claim));
  return claim;
}

/** The stashed claim, or null when there is none, it is unreadable, or it is stale. */
export function readInvitationClaim(now: number = Date.now()): InvitationClaim | null {
  const raw = readFrom(localStore(), CLAIM_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearInvitationClaim();
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    clearInvitationClaim();
    return null;
  }
  const { id, capturedAt } = parsed as Partial<InvitationClaim>;
  if (typeof id !== 'string' || !CLAIM_ID_PATTERN.test(id) || typeof capturedAt !== 'number') {
    clearInvitationClaim();
    return null;
  }
  // `capturedAt` in the future means a clock change, not a fresh claim. Treat it
  // as present rather than discarding a claim the user just made.
  if (now - capturedAt > INVITATION_CLAIM_MAX_AGE_MS) {
    clearInvitationClaim();
    return null;
  }
  return { id, capturedAt };
}

export function clearInvitationClaim(): void {
  writeTo(localStore(), CLAIM_KEY, null);
}
