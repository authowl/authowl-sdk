/**
 * The sign-in CHALLENGE, for browsers that will not keep our cross-site cookies.
 *
 * WHY THE SESSION TRANSPORT IS NOT ENOUGH
 *
 * `session-token.ts` carries the SESSION as a bearer token. On a credential
 * sign-in by a 2FA-enrolled user there is no session to carry: the engine
 * DELETES the one it just minted and issues a signed `two_factor` ticket instead
 * (600s), so `set-auth-token` has nothing to say. On the browsers this exists for
 * the ticket cookie is dropped exactly like the session cookie was, so the user
 * types a correct code and the verify finds neither a session nor a cookie and
 * answers `INVALID_TWO_FACTOR_COOKIE`. Every 2FA user on those browsers is locked
 * out of sign-in entirely - the population most likely to have enrolled a second
 * factor in the first place.
 *
 * THE WIRE, transcribed from `lib/http/request-site.ts` (`CHALLENGE_HEADER`) and
 * `lib/auth/bearer-session-token.ts` in the server repo, which own it:
 *
 *  - Responses carry `set-auth-challenge`, CORS-exposed. Its grammar is
 *    `Cookie`-header pairs, `<full-cookie-name>=<value>` joined by `"; "`.
 *  - Requests carry the same shape back as `x-authowl-challenge`.
 *  - Names are the FULL on-the-wire names (`p_<projectid>.two_factor`, wearing a
 *    `__Secure-` prefix in production). This module never parses, matches or
 *    lists them: which cookies may ride is server-owned and deliberately narrow,
 *    and the server ignores anything outside its own allowlist under its own
 *    project prefix. A name list here would be a second, drifting copy of a
 *    decision that is not ours - and it would have to know about `__Secure-`,
 *    which is an environment fact the SDK cannot see.
 *  - Values are BYTE-VERBATIM. The same bytes go back out as a cookie, so
 *    decoding, re-encoding or reshaping them on either side is a ticket that
 *    verifies on neither.
 *
 * APPLIED PER NAME, NEVER AS THE FULL SET
 *
 * This is the clause most likely to be got wrong, and getting it wrong is
 * silent. A name the header does not mention is UNCHANGED; only an empty value
 * (`<name>=`) deletes; and an ABSENT header means NO CHANGE rather than "clear".
 * Most responses carry no header at all - `/two-factor/send-otp` reads the ticket
 * and writes no cookie, and an ordinary `get-session` writes only the session
 * cache - so a store that treated the header as the authoritative set would drop
 * a live ticket on its very next request, and the email-OTP recovery factor would
 * die on this transport with nothing shown anywhere.
 *
 * A header naming one cookie and not the other must likewise leave the other
 * alone, for the same reason the oversize rule below refuses to truncate:
 * dropping `dont_remember` while keeping `two_factor` is the persistence flip.
 *
 * PRESENTED ON EVERY DECLARED REQUEST, NOT ONLY ON THE VERIFY
 *
 * "Challenge" reads as verify-only and that reading passes almost every test,
 * because `dont_remember` OUTLIVES the challenge it arrived with: `get-session`
 * reads it for the life of the session to decide whether to refresh expiry.
 * Presenting the store only when answering a code leaves a "don't remember me"
 * session quietly resuming refresh - the same unsafe direction as the storage
 * rule below, one step later. So it rides `declareOn` in `session-token.ts`, on
 * the same schedule and under the same single declaration as the session token,
 * rather than being attached by whichever call site knows it is doing 2FA.
 *
 * STORAGE IS SESSION-SCOPED, AND THAT IS THE SERVER'S CONTRACT RATHER THAN OUR
 * TASTE
 *
 * A header carries no cookie attributes, so the lifetime the jar used to enforce
 * becomes whatever this module picks - and for `dont_remember` the lifetime IS
 * the meaning. The engine writes it with no `Max-Age`, making it a
 * browsing-session cookie that dies with the window. Held in `localStorage`
 * instead it becomes permanent, and `get-session` then stops refreshing expiry
 * on every session this browser goes on to hold. It also flips the sign-ins that
 * pass no persistence flag of their own and therefore DEFER to the presented
 * cookie - phone OTP above all, which is this product's primary sign-in and
 * whose verify translates through this very transport. Nothing heals that but a
 * sign-out, because the paths that DO pass a flag neither read the stale cookie
 * nor clear it. Fail-safe in direction and therefore invisible.
 *
 * So: `sessionStorage`, never `localStorage`, and never the session token's slot
 * - which carries the OPPOSITE requirement (a token has to outlive the window to
 * be worth having) and would ride back out as `Authorization: Bearer` besides.
 *
 * `sessionStorage` is per TAB where the cookie was per browsing session, so it is
 * strictly NARROWER than what it replaces: a challenge begun in one tab cannot be
 * finished in another, and a tab that never saw the sign-in holds no
 * `dont_remember`. Both are the acceptable direction - the user is told the code
 * is invalid and starts again, or one tab treats a session as more persistent
 * than asked - where storage that outlives the window is wrong on every tab with
 * nothing shown.
 */
import { readFrom, sessionStore, writeTo } from './web-storage';

const CHALLENGE_KEY = 'authowl.session-challenge';

/**
 * Where a project's challenge is kept.
 *
 * Exported so the tests read the slot production actually writes. Not a nicety:
 * the assertion that matters most here is that `localStorage` holds NOTHING, and
 * an all-null assertion against a hand-typed key passes just as happily by
 * naming a slot nobody ever wrote to.
 */
export const challengeStorageKey = (projectId: string): string =>
  `${CHALLENGE_KEY}.${projectId}`;

/** Set by the server on any response that issues or destroys a challenge cookie. */
export const CHALLENGE_HEADER = 'set-auth-challenge';
/** How the same pairs go back. Honoured only on a request that DECLARED the transport. */
export const CHALLENGE_REQUEST_HEADER = 'x-authowl-challenge';

/**
 * Read the session-only persistence signal carried by core's challenge transport.
 * Framework adapters use this instead of recreating the challenge cookie grammar.
 */
export function sessionChallengeIsEphemeral(headers: Headers): boolean {
  const header = headers.get(CHALLENGE_REQUEST_HEADER);
  if (!accepted(header)) return false;
  return challengePairs(header).some(
    ([name, value]) => name.endsWith('.dont_remember') && value.length > 0,
  );
}

/**
 * The engine's answer when the ticket a verify presented is spent, expired, or
 * was never there.
 *
 * Reaching for the code rather than for a list of the endpoints that read a
 * ticket is deliberate: `/two-factor/send-otp` reads one too, and so will
 * whatever is added next. This SDK's recurring defect is wiring one request path
 * and missing the parallel one, and an endpoint list is that defect with a
 * different spelling.
 */
export const CHALLENGE_REJECTED_CODE = 'INVALID_TWO_FACTOR_COOKIE';

/**
 * The most `x-authowl-challenge` may weigh, and the same number the server
 * refuses above (`MAX_CHALLENGE_HEADER_LENGTH` in
 * `lib/auth/bearer-session-token.ts`), compared the same way so the two agree
 * exactly on the boundary. Two signed cookie values with their prefixed names is
 * a few hundred bytes, so this is generous by an order of magnitude.
 *
 * OVERSIZE IS REFUSED WHOLE, IN BOTH DIRECTIONS, AND NEVER TRUNCATED. Truncating
 * to fit would keep `two_factor` and drop `dont_remember`, which flips
 * persistence in the UNSAFE direction - a user who unchecked "remember me"
 * handed a persistent session on a shared machine. Sending nothing instead fails
 * the verify, which is a visible sign-in error rather than a silent downgrade,
 * and it leaves the store intact so a later deletion can bring it back under the
 * limit. Sending it anyway would be equivalent as far as this server is
 * concerned - it refuses the header whole - but an intermediary answering 431 to
 * a 2KB header would turn a failed verify into a failed request.
 */
const MAX_CHALLENGE_HEADER_LENGTH = 2048;

/**
 * A header string this side will handle AT ALL: one that is there, and that is
 * inside the ceiling above.
 *
 * The same rule governs all three doors - the slot read back at construction,
 * the value going out, and the header coming in - so it is written ONCE and in
 * one polarity. The comment above promises that this side and the server agree
 * exactly on the boundary, and a promise about a boundary is only checkable
 * while there is a single comparison to check; three spellings in two
 * polarities is how a fourth door comes to get the `<=` the wrong way round.
 */
const accepted = (header: string | null): header is string =>
  header !== null && header.length <= MAX_CHALLENGE_HEADER_LENGTH;

/**
 * RFC 6265 cookie-octet - the same test the server applies, and the reason it is
 * applied at all is the grammar rather than the value.
 *
 * A `;` or a `,` inside one value corrupts the pair BESIDE it on a single-line
 * header: `two_factor` smuggling a `;` would silently become a second, forged
 * name/value pair, and `dont_remember` would be lost in the same breath. The
 * engine's own values are base64url with a `.` and cannot contain either, so
 * this only ever fires on something that did not come from us.
 *
 * Whitespace is not a cookie-octet, so a value carrying any was never one of
 * ours either. It is refused WHOLE rather than trimmed into a different value:
 * trimming is the one thing a byte-verbatim credential cannot survive, and a
 * refused pair fails a verify visibly where a reshaped one fails its signature
 * silently.
 */
const COOKIE_OCTET = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

/**
 * `name=value` pairs in `Cookie`-header grammar, exactly as the server writes and
 * reads them.
 *
 * Split at the FIRST `=` only. `=` is itself a cookie-octet, so a signed value
 * ending in base64 padding contains one, and splitting on every `=` would truncate
 * the ticket to the part before its own padding - a value that verifies as
 * nothing, on the request that decides whether a second factor was proven.
 *
 * The only whitespace removed is what the `"; "` join and the `name =` shape can
 * introduce, around the SEPARATORS. The value keeps every byte after the first
 * `=`; see `COOKIE_OCTET` for what happens to one that should not have had them.
 */
function challengePairs(header: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const entry of header.split(';')) {
    const pair = entry.trimStart();
    const separator = pair.indexOf('=');
    // `<= 0` also rejects a nameless `=value`, which cannot be stored under any
    // name and cannot be re-emitted as one.
    if (separator <= 0) continue;
    pairs.push([pair.slice(0, separator).trimEnd(), pair.slice(separator + 1)]);
  }
  return pairs;
}

export type ChallengeStore = {
  /**
   * Put the held challenge on a request that has DECLARED the transport.
   *
   * Called by `declareOn` in `session-token.ts` and nowhere else, so the
   * challenge cannot ride a request the server will not read it on - and, more
   * to the point, cannot be FORGOTTEN by a request the server will.
   */
  presentOn(headers: Headers): void;
  /** Apply a response's `set-auth-challenge` - per name, never as the full set. */
  observe(headers: Headers): void;
  /** Drop everything. A challenge belongs to one session lifecycle and no more. */
  clear(): void;
};

export function createChallengeStore(projectId: string): ChallengeStore {
  const key = challengeStorageKey(projectId);
  const held = new Map<string, string>();

  /**
   * The store as one header value, or null when it holds nothing.
   *
   * The SAME string is what goes in storage, so there is one encoding rather than
   * two to drift apart, and a value that survives a reload is a value that
   * survived the wire.
   */
  function serialised(): string | null {
    if (held.size === 0) return null;
    return [...held].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function persist(): void {
    // Through `accepted` like every other door, so the ceiling really is written
    // once. It changes no outcome by itself - a slot written oversize would be
    // refused WHOLE at the next hydration, leaving the same empty store this
    // leaves behind, and the recovery a later deletion gives back runs off `held`
    // rather than off the slot. What it buys is that the slot never holds bytes
    // nothing will ever accept, and that the promise on `accepted` stays
    // checkable: one comparison, in one polarity, at every door. A fourth door
    // that skips it is how that promise quietly stops being true. Unreachable
    // anyway at two allowlisted cookies of a few hundred bytes.
    const value = serialised();
    writeTo(sessionStore(), key, accepted(value) ? value : null);
  }

  /**
   * Merge a header's pairs into the store, PER NAME.
   *
   * The three rules that make this correct, each of which fails silently on its
   * own: an empty value deletes, a name that is not mentioned is untouched, and a
   * value this side cannot re-emit verbatim is refused rather than reshaped.
   *
   * Validated PER PAIR, where the server validates the COLLAPSED winner - a
   * divergence from a rule the server calls load-bearing, and safe here only for
   * a reason that lives in the other repo. The server judges after collapsing so
   * that `<name>=good; <name>=bad,smuggled` refuses wholesale rather than falling
   * back to the superseded `good`. Its egress builds this header from a `Map`,
   * so a duplicate name cannot reach us and the two orderings cannot disagree.
   * If that ever stops being true, collapse before validating here.
   */
  function merge(header: string): void {
    for (const [name, value] of challengePairs(header)) {
      if (!COOKIE_OCTET.test(name)) continue;
      // The wire's deletion signal, and the only way the SDK ever learns to drop
      // a spent ticket. It is a signal FROM the server: an empty value is never
      // sent back, and the server's ingress ignores one if it ever were.
      if (value === '') held.delete(name);
      else if (COOKIE_OCTET.test(value)) held.set(name, value);
    }
  }

  // Hydrated once, at construction, because `sessionStorage` is per TAB: there is
  // no other tab to join a challenge from, only this one after the document was
  // replaced. That is the case that matters and it is not exotic - an app that
  // answers `twoFactorRedirect` by NAVIGATING to its own "enter your code" page
  // tears down this module and rebuilds it between the challenge and the verify,
  // and an in-memory-only store would lose the ticket on the way. Read back
  // through the same parser as the wire, so a corrupted or hand-edited slot
  // cannot inject a shape the wire could not have produced.
  const stored = readFrom(sessionStore(), key);
  if (accepted(stored)) merge(stored);

  return {
    presentOn(headers) {
      const value = serialised();
      // DELETE FIRST, unconditionally, then set at most one instance.
      //
      // The delete is what makes this the only writer: a caller-supplied
      // `x-authowl-challenge` on a request we are declaring would otherwise
      // survive and present a ticket this store never chose. And `set` rather
      // than `append`, because intermediaries fold duplicate request headers into
      // one comma-joined value - which does not merely add a pair, it corrupts
      // the pair on each side of the comma, so the ticket AND the persistence
      // flag are lost together.
      headers.delete(CHALLENGE_REQUEST_HEADER);
      if (accepted(value)) headers.set(CHALLENGE_REQUEST_HEADER, value);
    },
    observe(headers) {
      const header = headers.get(CHALLENGE_HEADER);
      // ABSENT MEANS NO CHANGE, NOT CLEAR. Most responses carry no header at all;
      // reading their silence as "the server holds nothing" clears a live ticket
      // on the very next request. Oversize is refused whole for the same reason
      // the request side refuses it: a partial application is the persistence
      // flip.
      if (!accepted(header)) return;
      merge(header);
      persist();
    },
    clear() {
      held.clear();
      persist();
    },
  };
}
