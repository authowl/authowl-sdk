/**
 * @vitest-environment jsdom
 *
 * The challenge store's own rules, against real `sessionStorage` and
 * `localStorage`.
 *
 * Every clause pinned here fails SILENTLY when it is got wrong, and each one in
 * a different direction: a store that reads the header as authoritative clears a
 * live ticket and kills the email-OTP recovery factor with nothing shown; a
 * store that reshapes a value hands back a ticket that verifies as nothing; a
 * store in `localStorage` stops expiry refresh on every session this browser
 * goes on to hold. None of them produces an error anywhere, which is why they
 * are pinned as rules here rather than left to the end-to-end flow in
 * `session-transport.test.ts` to imply.
 *
 * The names are treated as OPAQUE throughout, exactly as production must: they
 * are the server's full on-the-wire names, they wear a `__Secure-` prefix in an
 * environment the SDK cannot see, and which of them may ride is a server-owned
 * decision. A test that matched them would be asserting a rule the SDK does not
 * get to hold.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  challengeStorageKey,
  createChallengeStore,
  CHALLENGE_HEADER,
  CHALLENGE_REQUEST_HEADER,
  sessionChallengeIsEphemeral,
  type ChallengeStore,
} from './session-challenge';
import { sessionTokenStorageKey } from './session-token';

const PROJECT = '11111111-1111-1111-1111-111111111111';
const TICKET_COOKIE = 'p_11111111111111111111111111111111.two_factor';
const REMEMBER_COOKIE = 'p_11111111111111111111111111111111.dont_remember';

/**
 * A signed ticket as the engine actually writes one: base64url with a `.`, and
 * PERCENT-ENCODED, because the engine encodes cookie values and the same bytes
 * have to go back out as a cookie. Any decode-then-re-encode on either side is a
 * ticket that verifies on neither, and the failure is a correct code answered
 * with "invalid".
 */
const TICKET_VALUE = 'eyJpZCI6MX0%3D.c2lnbmF0dXJl%2Fzz';

const responseWith = (value: string) => new Headers({ [CHALLENGE_HEADER]: value });

/** What this store would put on a declared request, or null when it sends nothing. */
function presented(store: ChallengeStore): string | null {
  const headers = new Headers();
  store.presentOn(headers);
  return headers.get(CHALLENGE_REQUEST_HEADER);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('session persistence metadata', () => {
  it('reports only a live dont-remember challenge as session-only', () => {
    expect(sessionChallengeIsEphemeral(new Headers())).toBe(false);
    expect(sessionChallengeIsEphemeral(new Headers({
      [CHALLENGE_REQUEST_HEADER]: `${TICKET_COOKIE}=${TICKET_VALUE}`,
    }))).toBe(false);
    expect(sessionChallengeIsEphemeral(new Headers({
      [CHALLENGE_REQUEST_HEADER]: `${TICKET_COOKIE}=${TICKET_VALUE}; ${REMEMBER_COOKIE}=1`,
    }))).toBe(true);
  });
});

describe('the header is applied per name, never as the full set', () => {
  it('leaves a name the header does not mention untouched', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}; ${REMEMBER_COOKIE}=true.sig`));

    // The verify's response deletes the spent ticket and says nothing about
    // `dont_remember` - which the server reads for the LIFE of the session, not
    // just the challenge. Dropping it here is the persistence flip: a user who
    // unchecked "remember me" silently gets expiry refresh back.
    store.observe(responseWith(`${TICKET_COOKIE}=`));

    expect(presented(store)).toBe(`${REMEMBER_COOKIE}=true.sig`);
  });

  it('changes nothing when the response carries no header at all', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}`));

    // `/two-factor/send-otp` reads the ticket and writes no cookie, and an
    // ordinary `get-session` writes only the session cache - so MOST responses
    // look exactly like this one. Reading their silence as "the server holds
    // nothing" clears the live ticket on the very next request, and the
    // email-OTP recovery factor dies on this transport with nothing shown.
    store.observe(new Headers());

    expect(presented(store)).toBe(`${TICKET_COOKIE}=${TICKET_VALUE}`);
  });

  it('deletes on an empty value, and only on an empty value', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}; ${REMEMBER_COOKIE}=true.sig`));

    store.observe(responseWith(`${TICKET_COOKIE}=; ${REMEMBER_COOKIE}=false.sig`));

    // One name deleted, the other REPLACED, from a single header.
    expect(presented(store)).toBe(`${REMEMBER_COOKIE}=false.sig`);
  });

  it('sends nothing once the last name is deleted', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}`));
    store.observe(responseWith(`${TICKET_COOKIE}=`));

    // An empty `x-authowl-challenge` is not the same as no header: it is a
    // request header the server has to parse to learn it says nothing.
    expect(presented(store)).toBeNull();
  });
});

describe('values survive byte for byte', () => {
  it('round-trips a percent-encoded value through the wire and back', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}`));

    expect(presented(store)).toBe(`${TICKET_COOKIE}=${TICKET_VALUE}`);
  });

  it('round-trips it through storage, so a reload presents the same bytes', () => {
    createChallengeStore(PROJECT).observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}`));

    // A new store for the same project is what a reload produces: the module is
    // re-evaluated and memory is gone, but the tab - and its `sessionStorage` -
    // is the same one. A redirect sign-in lands the ticket in one document and
    // runs the verify in the next.
    expect(presented(createChallengeStore(PROJECT))).toBe(`${TICKET_COOKIE}=${TICKET_VALUE}`);
  });

  it('keeps a value that contains its own `=`', () => {
    const store = createChallengeStore(PROJECT);
    // base64 padding is `=`, and `=` is a cookie-octet. Splitting on every `=`
    // instead of the first would truncate the ticket to the part before its own
    // padding - a value that verifies as nothing, on the one request that
    // decides whether a second factor was proven.
    store.observe(responseWith(`${TICKET_COOKIE}=eyJhIjoxfQ==.sig`));

    expect(presented(store)).toBe(`${TICKET_COOKIE}=eyJhIjoxfQ==.sig`);
  });

  it('refuses a value it could not re-emit verbatim, rather than reshaping it', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${REMEMBER_COOKIE}=true.sig`));

    // A `,` is the character intermediaries fold duplicate request headers on,
    // so a value carrying one would come out the far side as two pairs -
    // corrupting the pair beside it rather than merely itself. The engine's own
    // values are base64url with a `.` and cannot contain one, so this only fires
    // on something that did not come from us; it is refused WHOLE, never trimmed
    // or escaped into a different value, because a byte-verbatim credential
    // cannot survive being reshaped.
    store.observe(responseWith(`${TICKET_COOKIE}=bad,smuggled`));

    expect(presented(store)).toBe(`${REMEMBER_COOKIE}=true.sig`);
  });

  it('keeps the pair beside a value that ran past its own separator', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=head;tail; ${REMEMBER_COOKIE}=true.sig`));

    // `;` is the pair separator, so a value containing one is not a corrupt
    // value - it is two entries, the second of which names nothing and is
    // dropped. Pinned because it is the same reading the server's ingress
    // applies, and a store that instead refused the whole header here would
    // throw away the intact `dont_remember` sitting beside it.
    expect(presented(store)).toBe(`${TICKET_COOKIE}=head; ${REMEMBER_COOKIE}=true.sig`);
  });
});

describe('exactly one header instance', () => {
  it('replaces a caller-supplied challenge rather than appending to it', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}`));

    const headers = new Headers({ [CHALLENGE_REQUEST_HEADER]: `${TICKET_COOKIE}=planted` });
    store.presentOn(headers);

    // Two instances of a request header are folded by intermediaries into one
    // comma-joined value, which does not add a pair - it corrupts the pair on
    // each side of the comma, losing the ticket AND the persistence flag
    // together. `Headers.getSetCookie` has no request-side equivalent, so the
    // absence of a comma IS the assertion available.
    expect(headers.get(CHALLENGE_REQUEST_HEADER)).toBe(`${TICKET_COOKIE}=${TICKET_VALUE}`);
  });

  it('removes a caller-supplied challenge when it holds nothing itself', () => {
    const store = createChallengeStore(PROJECT);

    const headers = new Headers({ [CHALLENGE_REQUEST_HEADER]: `${TICKET_COOKIE}=planted` });
    store.presentOn(headers);

    // Delete first, unconditionally: this store is the only writer, so a ticket
    // it never chose must not reach the wire on a request it is declaring.
    expect(headers.get(CHALLENGE_REQUEST_HEADER)).toBeNull();
  });
});

describe('storage is session-scoped', () => {
  it('writes the challenge to sessionStorage and never to localStorage', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}; ${REMEMBER_COOKIE}=true.sig`));

    expect(sessionStorage.getItem(challengeStorageKey(PROJECT)))
      .toBe(`${TICKET_COOKIE}=${TICKET_VALUE}; ${REMEMBER_COOKIE}=true.sig`);
    // `dont_remember` is written by the engine with no `Max-Age`: it dies with
    // the browsing session, and THAT lifetime is its meaning. Held durably it
    // stops expiry refresh on every session this browser goes on to hold, and
    // nothing but a sign-out heals it.
    expect(localStorage.getItem(challengeStorageKey(PROJECT))).toBeNull();
    // Every key, not just the one this module names: a challenge that reached
    // `localStorage` under any name is the same defect.
    expect(localStorage.length).toBe(0);
  });

  it('never lands in the session token\'s slot', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}`));

    // The token's slot carries the OPPOSITE requirement - a session token has to
    // outlive the window to be worth having - so a ticket parked there inherits
    // exactly the permanence above, and would ride back out as
    // `Authorization: Bearer` besides.
    expect(challengeStorageKey(PROJECT)).not.toBe(sessionTokenStorageKey(PROJECT));
    expect(sessionStorage.getItem(sessionTokenStorageKey(PROJECT))).toBeNull();
  });

  it('empties the slot when the challenge is dropped', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${TICKET_VALUE}`));

    store.clear();

    expect(presented(store)).toBeNull();
    // In storage as well as in memory, or a reload restores a challenge whose
    // session is over.
    expect(sessionStorage.getItem(challengeStorageKey(PROJECT))).toBeNull();
  });
});

describe('oversize is refused whole, in both directions', () => {
  const huge = 'x'.repeat(2049);

  it('ignores a response header the server would refuse anyway', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${REMEMBER_COOKIE}=true.sig`));

    store.observe(responseWith(`${TICKET_COOKIE}=${huge}`));

    // Applying the part that fits is the persistence flip in slow motion:
    // whatever is kept and whatever is dropped stop describing one sign-in.
    expect(presented(store)).toBe(`${REMEMBER_COOKIE}=true.sig`);
  });

  it('sends nothing rather than a header the server refuses, and keeps the store', () => {
    const store = createChallengeStore(PROJECT);
    store.observe(responseWith(`${TICKET_COOKIE}=${'y'.repeat(2000)}`));
    store.observe(responseWith(`${REMEMBER_COOKIE}=${'z'.repeat(200)}`));

    // Truncating to fit would keep `two_factor` and drop `dont_remember` - a
    // user who unchecked "remember me" handed a persistent session on a shared
    // machine. Sending nothing fails the verify instead, which is visible.
    expect(presented(store)).toBeNull();
    // Nothing was dropped to achieve that, so a deletion still brings the store
    // back under the limit rather than leaving it permanently unsendable.
    store.observe(responseWith(`${TICKET_COOKIE}=`));
    expect(presented(store)).toBe(`${REMEMBER_COOKIE}=${'z'.repeat(200)}`);
  });
});
