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
/**
 * The one hint the engine is allowed to put in an invitation link.
 *
 * It exists because the invitee usually has NO account, and the emailed link
 * lands them on the sign-in screen - the one screen they cannot use. The SDK
 * cannot work this out for itself: `getInvitation` is recipient-only, so the
 * invited address is unknowable until there is a session. The engine knows it at
 * send time, and says only this much.
 */
export const INVITATION_HINT_QUERY_PARAM = 'authowl_hint';
const CLAIM_KEY = 'authowl.invitation-claim';

/**
 * Ids are opaque to us, so the only thing worth asserting is that a hostile or
 * accidental value cannot become an unbounded storage write or a strange request
 * path. The engine issues uuids; this admits the same shape a little loosely
 * rather than pinning a format the server owns.
 */
const CLAIM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The only hint value that exists. There is deliberately no `existing_user`:
 * absence has to stay ambiguous across an existing account, an older AuthOwl,
 * and an account created between the invite and the click - so it can never be
 * read as proof that an address IS registered.
 */
export type InvitationRecipientHint = 'new_user';

export type InvitationClaim = {
  id: string;
  /** Epoch milliseconds, for age display and for expiring a forgotten claim. */
  capturedAt: number;
  /**
   * Present only when the engine said the invited address had no account. Use it
   * to land the invitee on sign-UP; never treat its absence as the opposite.
   */
  recipientHint?: InvitationRecipientHint;
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
  // The hint is ours and is stripped whether or not it arrived with an id, for
  // the same reason the id is: leaving our parameters in the tenant's URL is
  // litter, and one that survives into their analytics or a shared link is worse.
  const hinted = url.searchParams.get(INVITATION_HINT_QUERY_PARAM);
  if (hinted !== null) url.searchParams.delete(INVITATION_HINT_QUERY_PARAM);
  if (requested === null) {
    if (hinted !== null) {
      try {
        window.history.replaceState(window.history.state, '', url.toString());
      } catch {
        // Same tolerance as below: a page that refuses history rewriting still works.
      }
    }
    return readInvitationClaim(now);
  }
  url.searchParams.delete(INVITATION_QUERY_PARAM);
  try {
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // A page that refuses history rewriting still gets the claim below.
  }
  if (!CLAIM_ID_PATTERN.test(requested)) return readInvitationClaim(now);
  // Exact match, not a cast: the parameter is attacker-reachable, and anything
  // that is not the one value we understand is simply not a hint.
  const claim: InvitationClaim = {
    id: requested,
    capturedAt: now,
    ...(hinted === 'new_user' ? { recipientHint: 'new_user' as const } : {}),
  };
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
  const { id, capturedAt, recipientHint } = parsed as Partial<InvitationClaim>;
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
  // A claim stashed before the hint existed simply has none - that is a valid
  // claim, not a corrupt one, so it must not be discarded here.
  // Anything other than the one value we understand is not a hint. A claim
  // stashed before the hint existed has none at all, which is a valid claim
  // rather than a corrupt one, so it must not be discarded here.
  return recipientHint === 'new_user'
    ? { id, capturedAt, recipientHint }
    : { id, capturedAt };
}

export function clearInvitationClaim(): void {
  writeTo(localStore(), CLAIM_KEY, null);
}
