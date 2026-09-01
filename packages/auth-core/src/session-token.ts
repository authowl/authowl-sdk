/**
 * The session's second transport, for browsers that will not keep our
 * cross-site cookie.
 *
 * Safari shipped CHIPS in 18.4 and REMOVED it in 18.5 (WebKit 292975, restored
 * in 26.2). On those versions the `Partitioned` attribute is ignored, so the
 * session cookie is demoted to an ordinary third-party cookie and ITP drops it:
 * sign-in returns 200 and every request after it is signed out, with nothing in
 * any console. No cookie attribute can rescue that, which is why the server can
 * also hand the session back as `set-auth-token` and accept it as
 * `Authorization: Bearer`.
 *
 * COOKIE FIRST, AND MEASURED RATHER THAN ASSUMED
 *
 * A cookie this script cannot read is strictly safer than a token it can, so the
 * token is a fallback and not a replacement. But which browsers need it cannot
 * be decided from a user-agent string - Chrome with third-party cookies off,
 * Safari inside the broken window, an embedded webview - so the SDK finds out by
 * OBSERVING whether the cookie came back, and remembers the answer:
 *
 *   - Until it knows, it asks for the token and uses it. That way the very first
 *     sign-in works everywhere, including the browsers this exists for.
 *   - The moment a session read succeeds with no token attached, cookies
 *     demonstrably work here: the answer is recorded and the token is dropped
 *     from memory and from storage.
 *   - If the cookie did not come back, the token stays so the session survives a
 *     reload, which is the whole point.
 *
 * MEASURED ONCE PER SESSION, NOT ONCE PER BROWSER
 *
 * The verdict looks like a property of the browser, and the first version of
 * this file treated it as one: recorded once, kept forever. That is precisely
 * the fact Safari 18.5 disproved. A user measured as cookie-capable on 18.4 who
 * takes the point release is pinned to a transport that no longer works - every
 * sign-in afterwards returns 200, every following request is anonymous, and
 * nothing recovers it short of clearing site data, because a verdict of
 * "cookies work" stops the SDK ever asking for a token again.
 *
 * So the verdict is re-armed at every door that BEGINS a session
 * (`beginSession`), and again whenever one ENDS (`endSession`). It survives
 * reloads, which is what spares a Chrome user a token on every page load; it
 * does not survive a new session, which is what makes a browser that changed
 * underneath us recoverable.
 *
 * The cost, stated exactly, because re-arming is what spends the security budget
 * the section above promised: once per sign-in, a Chrome user holds a real
 * script-readable token, IN MEMORY, from the mint until the measurement drops
 * it. Storage is not part of that window - `persistToken` writes the token only
 * under a verdict of `bearer`, so a browser that keeps our cookies is never left
 * with a copy to find, whatever happens to the tab in between - for a token
 * MINTED under the gate, and only those: a token a pre-gate build already wrote
 * to disk is untouched by a probe that fails on the network, and sits there
 * until the construction heal below re-asks at the next page load.
 *
 * That gate is only honest if the measurement actually happens, so the MINT asks
 * for it (`measureWith`) rather than waiting for the host app to read the
 * session. Waiting was the hole: an app that signs in and navigates, or one that
 * renders on the server and never mounts a session store, never measured and
 * kept the copy for good. The measurement now costs one detached session read
 * per sign-in and lands about a round trip after the token does.
 *
 * State that bill plainly, because for most integrations it is a NEW request
 * rather than a rearranged one: every mint dispatches a detached `/get-session`,
 * and so does every page load that finds a stored token no verdict accounts for.
 * An app that never subscribed to the session store used to make neither call.
 * That is a permanent property of the design, not a bug and not a cost that goes
 * away once the feature settles: the verdict is not knowable without asking.
 *
 * A cross-tab sign-in costs more again, and the arithmetic belongs in one place.
 * The woken tab reads shared storage, and on this transport storage stays empty
 * until the verdict lands, so `notifyMutation` in `session-store.ts` wakes the
 * other tabs a SECOND time once the measurement settles on a token actually
 * held. Other tabs therefore adopt a bearer session one round trip later than
 * they would a cookie one, and spend two `/get-session` calls doing it rather
 * than one. Without that second wake-up they spend one and render SIGNED OUT
 * until the user touches them - which for a route-guard app means the background
 * tab navigates itself to /sign-in.
 *
 * The price of the gate, stated rather than discovered: a broken-cookie browser
 * that RELOADS inside that round trip loses the session and signs in again,
 * because nothing was written yet. That is one narrow window on the browsers
 * this exists for, against a durable script-readable credential on every browser
 * it does not.
 *
 * And the wider version of that price, because "one round trip" understates it
 * when the probe FAILS. A subscribed app re-probes on its next refresh, so the
 * window really is a round trip there. An integration that never subscribes has
 * no second door: the construction heal below needs a STORED token to know a
 * measurement is owed, and on a failed probe nothing was stored. So one network
 * blip during sign-in costs that integration the session at its next reload,
 * where before the gate it survived - by leaking. Fixing it properly means
 * letting a failed probe re-arm `measurementDue`, which is a store API change
 * and is queued rather than smuggled in here.
 *
 * ONE LIFECYCLE, NOT ONE FLAG PER DOOR
 *
 * `ephemeral` (where the token is kept) and `verdict` (whether a token is wanted
 * at all) are both properties of A SESSION, so both are set by the same pair of
 * calls at the same enumerated doors, rather than each door remembering to set
 * one of them. Every write to the token goes through `setToken`, so "captured
 * but never persisted" - a session that works until the tab reloads - cannot be
 * reintroduced by adding a writer.
 *
 * Note what that invariant now means, because the gate above looks like a
 * violation of it and is not. "Captured but never persisted" is a state this
 * file DELIBERATELY holds, for as long as the verdict is open. What the single
 * writer buys is that leaving it is not a thing a caller has to remember: one
 * function decides where the token lives, from the one fact that decides it, and
 * a browser proven to need storage gets it whether the token arrived before that
 * proof or after.
 *
 * THE SESSION IS NOT THE ONLY CARGO
 *
 * The session cookie is not the only cookie the engine carries state in, and one
 * of the others cannot wait for the session: on a credential sign-in by a 2FA
 * user the engine DELETES the session it just minted and issues a `two_factor`
 * ticket instead, so at that moment there is no session for any session
 * transport to carry. That ticket and the `dont_remember` flag beside it travel
 * as `set-auth-challenge` / `x-authowl-challenge` - see `session-challenge.ts`,
 * which owns their wire shape, their per-name merge rule and why their storage
 * has to be per browsing session rather than durable.
 *
 * They ride THIS store, under ONE declaration, rather than a transport of their
 * own: both answer the single condition "this browser will not keep our
 * cross-site cookies", and a caller on tokens for the session and cookies for the
 * challenge is a state nothing can handle - the sign-in half working and the
 * verify half not. `declareOn` and `observe` below carry both cargoes, so a
 * request that gets one cannot miss the other.
 *
 * WHAT THIS STILL DOES NOT FIX
 *
 * `trust_device` is deliberately REFUSED by the server rather than omitted: its
 * HttpOnly, jar-bound storage IS the mechanism by which "trust THIS device" means
 * this device, and a script-readable copy would be a portable 30-day
 * second-factor waiver that outlives sign-out. Device trust therefore does not
 * stick on these browsers, which costs convenience and never sign-in.
 *
 * The passkey challenge cookie is moot rather than refused: the engine builds the
 * plugin with no `rpID`, so the RP id falls back to the auth host, and WebAuthn
 * requires that id be a registrable-domain suffix of the CALLING page's origin -
 * the ceremony throws in the browser before any HTTP happens. Carrying its cookie
 * would change nothing.
 */
import { createChallengeStore } from './session-challenge';
import {
  SESSION_TOKEN_HEADER,
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
} from './session-transport-contract';
import { localStore, readFrom, sessionStore, writeTo } from './web-storage';

const TOKEN_KEY = 'authowl.session-token';
const BINDING_KEY = 'authowl.session-binding';
const COOKIE_VERDICT_KEY = 'authowl.cookie-transport';
const COOKIES_WORK = 'ok';
const BEARER_REQUIRED = 'bearer';

/**
 * Where a project's token and verdict are kept.
 *
 * Exported so the tests read the slot production actually writes. Not a nicety:
 * the assertions that matter most here are the ones proving a cookie-capable
 * browser is left holding NOTHING, and an all-null assertion against a
 * hand-typed key passes just as happily by naming a slot nobody ever wrote to.
 */
export const sessionTokenStorageKey = (projectId: string): string =>
  `${TOKEN_KEY}.${projectId}`;
export const sessionBindingStorageKey = (projectId: string): string =>
  `${BINDING_KEY}.${projectId}`;
export const cookieVerdictStorageKey = (projectId: string): string =>
  `${COOKIE_VERDICT_KEY}.${projectId}`;

/** Set by the server on a response that established a session, when asked for. */
export { SESSION_TOKEN_HEADER } from './session-transport-contract';
/**
 * The declaration. It is NOT merely "please mint me a token": the server reads
 * this same header on the way IN to decide whether an `Authorization: Bearer` is
 * a session at all.
 *
 * The engine is a real OAuth authorization server, where `Authorization: Bearer`
 * already means "access token" on `userinfo`, so the bearer alone cannot be
 * trusted to name a session - a tenant calling their own API through this origin
 * must keep the cookie they arrived with. A bearer WITHOUT this header is
 * therefore not refused, it is ANONYMOUS: the safe direction, and a completely
 * silent one. A request that carries the token and forgets the header is a
 * signed-out user with a 200 and nothing in any console.
 *
 * That is why `declareOn` below sets the pair or neither, and never one.
 */
export {
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
} from './session-transport-contract';

/**
 * Tri-state on purpose. "Not yet measured" and "measured, needs the token" both
 * ask for a token, but only the first is worth spending a probe on.
 *
 * Persisted EXPLICITLY rather than inferred from whether a token happens to be
 * in storage. The inference was a bug with two heads: a token left behind by an
 * expired or remotely revoked session read back as "measured, bearer", which
 * pinned `needsProbe()` false forever, so the next sign-in captured a token that
 * was never persisted and the user was signed in until the next reload restored
 * the DEAD one. Deriving state from a credential's presence means the credential
 * outliving its session corrupts the state.
 */
type CookieVerdict = 'unknown' | 'cookies' | 'bearer';

function decodeVerdict(stored: string | null): CookieVerdict {
  if (stored === COOKIES_WORK) return 'cookies';
  if (stored === BEARER_REQUIRED) return 'bearer';
  return 'unknown';
}

function encodeVerdict(verdict: CookieVerdict): string | null {
  if (verdict === 'cookies') return COOKIES_WORK;
  if (verdict === 'bearer') return BEARER_REQUIRED;
  return null;
}

/** How a session BEGINS, as the minting door knows it. */
export type SessionStart = {
  /**
   * Whether the session is meant to outlive the tab.
   *
   * `dont_remember` is a SECOND cookie, and on the browsers this transport
   * exists for it is dropped exactly like the session cookie is - so the engine
   * never sees it and treats every bearer session as persistent. The token is
   * the only copy of that session the SDK controls, so "don't remember me" has
   * to be honoured by WHERE it is kept: `sessionStorage`, which dies with the
   * tab, rather than `localStorage`, which does not.
   *
   * NOTE the behaviour change that buys: `sessionStorage` is per TAB, where
   * `dont_remember` was per browser session. A "don't remember me" bearer
   * session is therefore not shared with other tabs. That is deliberate and it
   * is the safe direction (a session that ends too soon rather than one that
   * outlives the machine's owner), but it is a real difference from the cookie
   * transport and callers should not discover it by accident.
   */
  remember: boolean;
};

/**
 * One session read, from the moment it is dispatched to the moment it answers.
 *
 * Cut by the store, so the rule about which answers may be acted on lives with
 * the state it protects rather than being restated by every caller. The token
 * the read is about is captured INSIDE it: `hasToken` explains why nothing hands
 * the credential out, and a receipt that leaked it would be the same hole with a
 * shorter lifetime.
 */
export type SessionRead = {
  /**
   * Whether the read this receipt was cut for actually presented a token.
   *
   * The cookie measurement turns on it: a read that carried NO token and still
   * found a session IS the proof that our cross-site cookie survives here.
   */
  readonly carriedToken: boolean;
  /**
   * The read came back with no session. End the session it was reading - unless
   * the token it presented is no longer the session in play.
   *
   * This is the path-independent catch for every ending that is not sign-out:
   * expiry, a revoke from another device, `account.revokeSession` called with
   * your own id, `account.delete`, an admin ban. None of those are visible in
   * the response to the call that caused them, and a token we PRESENTED and got
   * nothing back for is dead by definition.
   */
  endIfDead(): void;
  /**
   * Record what this read proved about the browser's cookies. `true` means the
   * cookie came back and no token is needed here.
   *
   * On the receipt rather than on the store, because a detached read answers
   * "there is no cookie session" for two completely different reasons, and only
   * one of them is about the browser. A probe dispatched for one session and
   * answered after that session ENDED - a sign-out, or a sign-out and a fresh
   * sign-in, both of which fit inside one probe's round trip - reports the
   * signed-out gap as a broken cookie. Acting on it would record `bearer` on a
   * browser whose cookies are fine and then persist the NEXT session's token to
   * disk under it, which is the exact defect this gate exists to remove, and it
   * would stick until the sign-in after next.
   *
   * Two facts here, with different authorities, and reading them as one is what
   * this comment used to license. RECORDING the verdict needs no token-value
   * comparison of the kind `endIfDead` does: it is a statement about the
   * BROWSER, every tab on this origin is the same browser, and a verdict
   * wrongly skipped only costs another measurement. The WRITE it unlocks is the
   * opposite - the token this receipt closed over is at least a probe round trip
   * old, and across tabs arbitrarily old, so flushing it unguarded puts a
   * superseded credential into the slot every tab shares. See `flushHeldToken`,
   * which is where that write goes and why.
   */
  recordCookieVerdict(cookiesWork: boolean): void;
};

export type SessionTokenStore = {
  /**
   * Whether a token is held. Deliberately not a getter for the token itself:
   * `declareOn` is the only thing that puts it on the wire, so nothing else
   * needs the credential in hand.
   */
  hasToken(): boolean;
  /** Thumbprint paired with the current token, or null for a legacy unbound session. */
  bindingThumbprint(): string | null;
  /**
   * Put this request on the transport - EVERY header, or none of them.
   *
   * The declaration, the bearer when one is held, and the challenge when one is
   * held. Returns whether it declared, which is also the only condition under
   * which the response can carry either cargo back.
   *
   * The challenge rides here rather than at whichever call site knows it is
   * doing 2FA, and that is the point of the shape: `dont_remember` outlives the
   * challenge it arrived with - `get-session` reads it for the life of the
   * session to decide expiry refresh - so a store presented only when answering
   * a code leaves a "don't remember me" session quietly resuming refresh. A
   * request that is on this transport at all is on it for both cargoes.
   */
  declareOn(headers: Headers): boolean;
  /**
   * Whether this transport is still in play at all - for EITHER cargo, since one
   * declaration governs both.
   *
   * False only once cookies are PROVEN to work here, after which `declareOn`
   * changes nothing and no response can carry a token or a challenge back - so a
   * caller may skip the decoration entirely rather than copy headers it will not
   * touch. A browser that keeps our cookies keeps the ticket in its jar, where it
   * is HttpOnly and strictly safer than anything a header can carry.
   */
  wantsToken(): boolean;
  /** Whether this browser's cookie behaviour is still unmeasured. */
  needsProbe(): boolean;
  /**
   * Capture a token the server handed back, and put it where it belongs.
   *
   * "Where it belongs" is MEMORY until the cookie has demonstrably failed. The
   * verdict is not knowable at the moment of capture and the token is not needed
   * on most browsers, so the safe order is to hold it, ask, and write only if
   * the answer says this browser has no other way to keep a session. Capturing
   * one is also what ASKS the question - see `measureWith` - because a gate on a
   * measurement nobody runs is just a session that dies at the next reload.
   */
  observe(headers: Headers): void;
  /**
   * The server rejected the challenge this store presented: the ticket is spent,
   * expired, or was never there, and the user has to start at the first factor
   * again.
   *
   * Separate from `endSession` because no session ended - the challenge one was
   * pending on did. Keeping the store instead would present a dead ticket on
   * every later request, and keep a `dont_remember` that no longer describes
   * anything, for as long as the tab lives.
   */
  dropChallenge(): void;
  /**
   * Register the one thing that can actually settle the verdict: a session read
   * with the token deliberately detached. The store holds the question and every
   * fact bearing on it, and none of the network.
   *
   * Called the moment a token is captured with the verdict still unmeasured, and
   * at registration if that already happened. Registration is what makes this
   * work at all: a controller registers when a CLIENT is built, so the
   * measurement no longer waits on a host app subscribing to the session store -
   * which is a thing plenty of integrations never do, and every one of them used
   * to keep a durable token for it.
   *
   * At most one measurer. A second registration replaces the first rather than
   * joining it, because StrictMode double-invokes the memo that builds a client
   * and two probes answer one question.
   */
  measureWith(measure: () => void): void;
  /**
   * Cut a receipt for a session read that is about to go out.
   *
   * A session read is answered asynchronously, and the session can be replaced
   * while one is in flight - by a sign-in in THIS tab (`observe` runs inside the
   * fetch decorator, while the store's post-mutation refresh only fires once the
   * action resolves), or by one in ANOTHER tab, which lands in shared storage
   * that this store holds no copy of. A read that started before either and
   * comes back "no session" then describes a session that no longer exists, and
   * acting on it wipes the token that just replaced it: a silent sign-out
   * immediately after a successful sign-in, in whichever tab reloads first.
   *
   * The caller states no rule of its own. It cuts the receipt before dispatch
   * and hands the answer back; deciding whether that answer still describes the
   * session in play needs both the token and the lifecycle, and this is the only
   * thing that has them.
   */
  beginRead(): SessionRead;
  /**
   * A session BEGINS here, before the request that mints it goes out.
   *
   * Called pre-dispatch at every minting door, because both facts it sets have
   * to be true by the time the RESPONSE arrives: the verdict decides whether the
   * request declares the transport at all (and an un-re-armed "cookies work"
   * means it does not, so no token is ever minted), and `remember` decides where
   * the token that comes back is written.
   *
   * It deliberately does NOT drop the token already held. Several minting doors
   * run ON an existing session - the 2FA verifies upgrade a pending one, phone
   * and email OTP verification can run signed in - so dropping the credential
   * before dispatch would send the very request that needs it out anonymous. A
   * failed attempt (a mistyped password at a re-auth prompt, a wrong OTP) would
   * likewise sign the user out locally on exactly the browsers this exists for.
   * The old token is replaced when the new one ARRIVES, which is the only moment
   * the old session is actually over.
   */
  beginSession(start: SessionStart): void;
  /** Select the safer cookie-only path before a new session is minted. */
  useCookieTransport(): void;
  /** Drop a previous bearer only after its replacement cookie was delivered. */
  completeCookieTransport(): void;
  /** Select bearer delivery and remember which browser key the new token binds to. */
  useBoundBearerTransport(thumbprint: string, keyIsPersistent: boolean): void;
  /**
   * A session ENDS here, unconditionally: this is sign-out, the one ending a
   * response states plainly, and it means "end whatever is in play".
   *
   * Every other ending - expiry, a revoke from another device, the account
   * deleted - is invisible in the response to the call that caused it and is
   * caught instead by `SessionRead.endIfDead`, which has to establish that the
   * ending is even about the session it is holding.
   */
  endSession(): void;
};

function createStore(projectId: string): SessionTokenStore {
  const tokenKey = sessionTokenStorageKey(projectId);
  const bindingKey = sessionBindingStorageKey(projectId);
  const verdictKey = cookieVerdictStorageKey(projectId);
  // Built here, and reachable only through this store, so nothing can attach the
  // challenge to a request without the declaration that makes the server read it
  // - or, the direction that actually breaks sign-ins, attach the declaration
  // without the challenge.
  const challenge = createChallengeStore(projectId);

  let token: string | null = null;
  let bindingThumbprint: string | null = null;
  let pendingBindingThumbprint: string | null = null;
  /** Where the token currently HELD actually lives. Set only by `hydrate`. */
  let ephemeral = false;
  /**
   * Where the NEXT token to arrive belongs, declared by the door that asked for
   * it and applied only when one actually lands.
   *
   * Applied on arrival rather than at the door because a door can fail. Assigning
   * `ephemeral` at the door would flip it on the attempt alone - a signed-in
   * "don't remember me" user mistyping an email OTP - and the next token to
   * arrive would be written to `localStorage` under it, silently promoting a
   * session they asked not to have remembered. Keeping the two apart also leaves
   * `ephemeral` a statement about the token actually HELD, which is what lets
   * `currentToken` overwrite it on hydration without destroying a door's intent.
   * The residue is that an intent left dangling by a failed attempt is consumed
   * by the next token to arrive, which could be a rotation rather than a fresh
   * sign-in (`/change-password` with `revokeOtherSessions`). That is a strictly
   * narrower window than the one it closes.
   */
  let pendingEphemeral: boolean | null = null;
  let verdict: CookieVerdict = decodeVerdict(readFrom(localStore(), verdictKey));
  /**
   * One home for "is this browser's cookie behaviour still unmeasured", in one
   * polarity - `needsProbe` is the same question asked from outside. Declared
   * here rather than beside `wantsToken` because the construction heal below
   * runs first, and because three spellings in two polarities is how a fourth
   * door comes to get the comparison the wrong way round.
   */
  const unmeasured = () => verdict === 'unknown';
  let generation = 0;
  /**
   * The thing that can settle the verdict, and whether it is owed a run.
   *
   * Owed rather than fired and forgotten, because the store is built before
   * anything that can measure and outlives every one of them:
   * `createAuthActionClient` starts the cross-site handoff exchange BEFORE it
   * builds the session controller, so a token can be captured with no measurer
   * registered. Dropping the request there would leave a broken-cookie browser
   * holding a token it is never allowed to persist - a session that dies at
   * every reload, on exactly the browsers this transport exists for.
   */
  let settleVerdict: (() => void) | null = null;
  let measurementDue = false;

  /**
   * Read the token out of storage, and record WHERE it was found.
   *
   * `sessionStorage` FIRST, because that is where a "don't remember me" session
   * lives: finding it there has to keep the session ephemeral, or a later
   * re-persist would quietly promote it to a durable one. On a miss `ephemeral`
   * is left alone - it describes the token actually held, and there is none.
   */
  function hydrate(): string | null {
    const perTab = readFrom(sessionStore(), tokenKey);
    if (perTab !== null) {
      ephemeral = true;
      return perTab;
    }
    const durable = readFrom(localStore(), tokenKey);
    if (durable !== null) {
      ephemeral = false;
      return durable;
    }
    return null;
  }

  function hydrateBinding(): string | null {
    return readFrom(sessionStore(), bindingKey) ?? readFrom(localStore(), bindingKey);
  }

  // Eagerly, not on first use: `setToken` persists through `ephemeral`, so an
  // `observe` that lands before anything has read the token would otherwise
  // write against a placement nothing had established.
  token = hydrate();
  bindingThumbprint = token === null ? null : hydrateBinding();
  // A stored token under an unmeasured browser is a question that has to be
  // settled at this page load rather than at the next sign-in, because on the
  // integrations that produce it there may not BE a next sign-in - the leaked
  // token is the live session and the app just keeps using it. A MINT cannot
  // leave it, because nothing reaches storage until the verdict closes. What
  // does: a build from before the gate, and `armVerdict` re-opening the question
  // over a token already stored - a re-authentication, or a social redirect the
  // user abandons - which the page load then interrupts.
  if (token !== null && unmeasured()) measurementDue = true;

  /**
   * Run the measurement now if one is owed and there is anything to run it.
   *
   * The throw is swallowed for the same reason `web-storage.ts` swallows its
   * own: this runs INSIDE the response that minted the token, so an escaping
   * error would fail the sign-in that just succeeded. A measurement that never
   * happened costs a browser its verdict until the next mint or the next page
   * load, both of which ask again; a sign-in that throws costs the user the
   * account.
   */
  function measureNow(): void {
    // Both halves of "owed", asked here rather than by each caller. The order
    // matters: an owed measurement with nothing to run it leaves the debt
    // STANDING, which is what carries it to the registration that can pay it.
    if (!measurementDue || !settleVerdict) return;
    measurementDue = false;
    try {
      settleVerdict();
    } catch {
      // Ignored - see above.
    }
  }

  /**
   * Write the token where this session's persistence says it belongs - and only
   * once this browser has PROVEN it needs one.
   *
   * The gate is here rather than at the call site so that `setToken` stays the
   * single writer and the question stays "when", not "who". Until the cookie has
   * demonstrably failed, both stores are cleared rather than left alone:
   * skipping the write would leave a SUPERSEDED token in storage for `hydrate`
   * and `liveToken` to adopt - a tab that reloads mid-measurement resuming a
   * session that has already been replaced.
   *
   * TWO DOORS, AND ONLY ONE OF THEM MAY COME HERE DIRECTLY. This writes whatever
   * is in `token` into storage every tab shares, with no check that memory is
   * still the newest fact - so the caller has to BE the newest fact. `setToken`
   * is, by construction: it assigned `token` on the line above. The verdict
   * receipt is not, and goes through `flushHeldToken` below.
   */
  function persistToken(): void {
    const stored = verdict === 'bearer' ? token : null;
    const storedBinding = stored === null ? null : bindingThumbprint;
    const [keep, drop] = ephemeral
      ? [sessionStore(), localStore()]
      : [localStore(), sessionStore()];
    writeTo(drop, tokenKey, null);
    writeTo(drop, bindingKey, null);
    writeTo(keep, tokenKey, stored);
    writeTo(keep, bindingKey, storedBinding);
  }

  /**
   * The ONLY writer. Memory and storage move together, so a future caller cannot
   * capture a token and forget to persist it - which is how a Safari session
   * came to work right up until the tab reloaded and restored an older one.
   */
  function setToken(next: string | null): void {
    if (next !== null && pendingEphemeral !== null) {
      ephemeral = pendingEphemeral;
      pendingEphemeral = null;
    }
    if (next !== null && pendingBindingThumbprint !== null) {
      bindingThumbprint = pendingBindingThumbprint;
      pendingBindingThumbprint = null;
    } else if (next === null) {
      bindingThumbprint = null;
    }
    token = next;
    persistToken();
    // LAST, and only for a token now held: this is the other half of the gate
    // above. Holding a credential the verdict has not judged is the whole cost
    // of this transport, so capturing one is what asks for the judgement, and
    // being last leaves nothing here for a measurer that answers synchronously
    // to corrupt.
    if (next !== null && unmeasured()) {
      measurementDue = true;
      measureNow();
    }
  }

  /**
   * The ONLY writer of the verdict, in memory AND in storage.
   *
   * Both copies move together because they are one fact - the same rule
   * `setToken` enforces for the token, for the same reason. Moving only the
   * in-memory one would leave a reload restoring the stale answer, which is the
   * "state outliving what it describes" defect one level down.
   */
  function setVerdict(next: CookieVerdict): void {
    verdict = next;
    writeTo(localStore(), verdictKey, encodeVerdict(next));
  }

  /** Put the measurement back in play. */
  function armVerdict(): void {
    setVerdict('unknown');
    // Nothing is owed for a session that has not minted yet. The door about to
    // dispatch either mints - and asks again, for the session it actually
    // established - or fails, and a measurement taken for the attempt would
    // describe the gap between two sessions rather than the browser.
    measurementDue = false;
  }

  /**
   * The token this store speaks for, re-hydrating when memory is empty.
   *
   * The re-read is the cross-tab case, and that means `localStorage`
   * specifically. A tab already open when another signs in read storage once, at
   * construction, so without this it refreshes with no credential, gets an
   * anonymous answer, and - because the measurement only runs on a read that
   * found a session - sits signed out until it is reloaded, while the cookie
   * transport would have shared the session for free.
   *
   * A "don't remember me" session is deliberately NOT picked up this way: it
   * lives in `sessionStorage`, which is per tab. `hydrate`'s first branch is
   * reachable from here only for a second store instance in this same tab.
   */
  function currentToken(): string | null {
    if (token === null) {
      token = hydrate();
      bindingThumbprint = token === null ? null : hydrateBinding();
    }
    return token;
  }

  /**
   * The token in play RIGHT NOW: re-read from storage rather than believed from
   * memory, and adopted into memory when the two disagree.
   *
   * `currentToken` above re-reads only when memory is empty, which is enough to
   * JOIN a session another tab established but not to notice one that REPLACED
   * ours. Storage is the only copy the tabs share, so it is the only authority
   * on which session is current, and a tab holding a superseded token has no way
   * to learn that without asking it.
   *
   * Adopting is the point, not a side effect: a caller that discovers its token
   * is stale must be left presenting the live one, or it spends every request
   * until the next reload on a credential the server has already forgotten.
   *
   * Falls back to memory when storage says nothing. Storage is unavailable in
   * private browsing and inside webviews - the same population this transport
   * exists for - and reading "storage is silent" as "our token is stale" there
   * would strand a token that has no other home.
   */
  function liveToken(): string | null {
    const stored = hydrate();
    if (stored !== null) {
      token = stored;
      bindingThumbprint = hydrateBinding();
    }
    return token;
  }

  /**
   * The verdict receipt's door to storage: write the token this read was cut
   * for, but only if it is still the token in play.
   *
   * The gate moved the moment "the token reaches shared storage" from capture
   * time to a later, CONDITIONAL event, and the write authority did not move
   * with it. `setToken` holds a token it minted on the line above, so it is the
   * newest fact by construction. A receipt holds one at least a probe round trip
   * old and, across tabs, arbitrarily old - and both callers reached the same
   * unguarded `persistToken`, where nothing in the name or the signature said
   * which of the two you were.
   *
   * What that cost, watching the shared slot go `T_new` -> `T_old` -> `null`:
   * tab B is signed in, unmeasured, with a probe in flight. Tab A signs out and
   * back in inside that round trip and its fresh `T_new` lands in the slot both
   * tabs share. B's probe answers `bearer`; B's generation never moved, so the
   * verdict is recorded and B flushes its `T_old` straight over `T_new`. Then
   * B's next dead read hydrates back the `T_old` it just wrote, so
   * `liveToken() !== snapshot` PASSES, the generation still matches, and
   * `endCurrentSession` wipes the slot in every tab - A included, which finds
   * out at its next reload.
   *
   * `liveToken` rather than a bare comparison, because adopting the live value
   * is the second half of the same fix: returning here without it would leave
   * this tab presenting a token the server has already forgotten on every
   * request until it reloads. The same primitive, for the same reason, as the
   * cross-tab guard in `endIfDead`.
   */
  function flushHeldToken(snapshot: string | null): void {
    if (liveToken() !== snapshot) return;
    persistToken();
  }

  /** Everything an ending means, shared by sign-out and the dead-read catch. */
  function endCurrentSession(): void {
    generation += 1;
    pendingEphemeral = null;
    pendingBindingThumbprint = null;
    // Back to the default rather than left as the last session set it:
    // `ephemeral` describes a session, and the next one has not said yet.
    ephemeral = false;
    setToken(null);
    // The challenge goes with it. Both things it holds belong to the session
    // that just ended: a spent `two_factor` ticket is dead weight, and a
    // `dont_remember` outliving its session is the persistence flip - presented
    // to the next sign-in that passes no flag of its own (phone OTP, email OTP,
    // magic link, the OAuth callbacks), which DEFERS to the presented cookie and
    // quietly stops refreshing expiry for the life of that session.
    //
    // The narrow cost, stated rather than discovered: this also runs from
    // `endIfDead`, so a background session read that dies while a fresh 2FA
    // challenge is pending takes the ticket with it. That needs a token already
    // held at the moment of the challenge - a re-authentication by a signed-in
    // user - and it fails in the safe direction, as a code the user is told to
    // enter again.
    challenge.clear();
    // The measurement goes with it. A verdict recorded under the session just
    // ended is evidence about a browser that may since have taken a point
    // release, and keeping the good one was how a Safari 18.4 user became
    // permanently unable to sign in on 18.5.
    armVerdict();
  }

  /** One home for "is the token transport still in play", read by both callers below. */
  const wantsToken = () => verdict !== 'cookies';

  return {
    hasToken: () => currentToken() !== null,
    bindingThumbprint: () => {
      currentToken();
      return bindingThumbprint;
    },
    declareOn(headers) {
      // The caller's own `Authorization` wins, and suppresses the declaration
      // with it. Declaring here would tell the server to read THEIR bearer as a
      // session - the exact confusion between an OAuth access token and a
      // session that the paired-header contract exists to prevent.
      if (headers.has('authorization')) return false;
      const value = currentToken();
      if (!value && !wantsToken()) return false;
      if (value) headers.set('authorization', `Bearer ${value}`);
      headers.set(SESSION_TRANSPORT_HEADER, SESSION_TRANSPORT_BEARER);
      // AFTER the early returns above, deliberately. A request that is not
      // declaring is not on this transport, and the server ignores
      // `x-authowl-challenge` without the declaration - so presenting it there
      // would be a live ticket on the wire that nothing reads.
      //
      // And NOT conditional on holding a token: the request this whole feature
      // exists for - the 2FA verify - carries a ticket and NO session, because
      // the engine deleted the session to issue the ticket.
      challenge.presentOn(headers);
      return true;
    },
    wantsToken,
    needsProbe: unmeasured,
    observe(headers) {
      const value = headers.get(SESSION_TOKEN_HEADER);
      if (value) setToken(value);
      // Unconditionally, and not inside the branch above. The response that
      // issues a `two_factor` ticket carries NO token by construction, so gating
      // the challenge on a token arriving would discard exactly the one response
      // this transport was added for.
      challenge.observe(headers);
    },
    dropChallenge: challenge.clear,
    measureWith(measure) {
      settleVerdict = measure;
      measureNow();
    },
    beginRead() {
      // `currentToken`, not the raw field. A tab that has not touched its token
      // since construction holds null in memory with a live one in storage, and
      // `declareOn` hydrates and attaches it anyway - so reading the field here
      // would report `carriedToken: false` for a request that demonstrably
      // carried one, and the measurement would then record "cookies work" off a
      // token-carrying read and drop the credential the session runs on.
      const snapshot = currentToken();
      const atGeneration = generation;
      return {
        carriedToken: snapshot !== null,
        endIfDead() {
          // Nothing was presented, so nothing was disproven. A signed-out page
          // reads null on every focus; ending "the session" there would bump the
          // generation and re-arm the measurement on every one of them.
          if (snapshot === null) return;
          // Compares the token VALUE against shared storage, because the
          // lifecycle counter below is per store and therefore per TAB. Tab A
          // signing out and back in writes a new token to `localStorage` while
          // this tab's counter never moves, so a counter-only guard passes and
          // this tab's dead read clears the token tab A is running on - which A
          // does not notice until its next reload, because it is working off its
          // own in-memory copy. The wake-up machinery manufactures exactly that
          // interleaving: A's sign-out ping is what launched this read, A's
          // sign-in ping joins it rather than superseding it, and background-tab
          // throttling stretches it over seconds.
          //
          // `liveToken` has already adopted the live value, and that is the
          // other half of the same bug: returning here without it would leave
          // this tab presenting the dead token on every request until it
          // reloads - the wipe fixed, the stale-memory loop left running.
          if (liveToken() !== snapshot) return;
          // Same token, but a door may have BEGUN a session that has not landed
          // yet: a sign-in dispatched while this read was open. The token does
          // not move until the new one ARRIVES, so no value comparison can see
          // that, and tearing down here would discard the door's `remember`
          // intent - the token that then arrives for a "don't remember me"
          // sign-in goes to `localStorage`, silently promoting a session the
          // user asked not to have kept.
          if (generation !== atGeneration) return;
          endCurrentSession();
        },
        recordCookieVerdict(cookiesWork) {
          // The session this was measured under is over, so the answer is about
          // the gap after it rather than about the browser. See the type.
          if (generation !== atGeneration) return;
          // Already answered for this generation, so this is a late second
          // opinion and must not overwrite the settled one. Two probes can be in
          // flight at once - two controllers on one project each hold their own
          // `measurement`, which is per-controller and cannot see the other - and
          // a late `bearer` landing on a browser already proven cookie-capable
          // would declare the transport on every request until the next
          // `beginSession`. Idempotent by construction: `armVerdict` runs only
          // from `beginSession` and `endCurrentSession`, both of which bump the
          // generation first, so `'unknown'` is exactly "this generation is
          // unanswered". It also demotes the dispatch-side `needsProbe()` checks
          // from correctness rules to optimisations, which is what they read as.
          if (!unmeasured()) return;
          setVerdict(cookiesWork ? 'cookies' : 'bearer');
          // Proven unnecessary here. Drop it rather than keep a credential
          // around that nothing will read - and drop it from storage too, which
          // is the whole reason `setToken` owns both.
          if (cookiesWork) {
            setToken(null);
            return;
          }
          // Proven NECESSARY here, which is the moment the token stops being a
          // momentary risk and becomes the only copy of the session this browser
          // has. Flush it to the placement this session declared.
          //
          // AFTER `setVerdict`, deliberately: the verdict this receipt carries
          // is correct even when the token it carries is not - see the type -
          // and only the write has to be held to the higher bar.
          //
          // Not `setToken`: re-running the writer would consume a
          // `pendingEphemeral` left behind by a door whose request never minted
          // - a signed-in user mistyping an OTP - and write the token actually
          // held under the FAILED attempt's "remember me" answer. Nothing about
          // the value changes here, only where it is kept.
          //
          // And not `persistToken` either, which writes memory into the slot
          // every tab shares with no check that memory is still the newest fact.
          // This receipt is a probe round trip old. `flushHeldToken` is where
          // that question lives.
          flushHeldToken(snapshot);
        },
      };
    },
    beginSession({ remember }) {
      generation += 1;
      pendingEphemeral = !remember;
      // The challenge IS dropped here, unlike the token above.
      //
      // The token is kept because several minting doors run ON an existing
      // session and would otherwise dispatch anonymous. Nothing in the challenge
      // is like that: the 2FA verifies deliberately do NOT begin a session - they
      // continue the one the credential sign-in began - so no door that needs a
      // ticket passes through here, and everything a previous attempt left is
      // stale by definition. Keeping it is what plants an abandoned attempt's
      // `two_factor` on the next sign-in, where it leaves which ticket the engine
      // consumes to parse order, and a previous session's `dont_remember` on an
      // email- or phone-OTP sign-in, which defers to it.
      challenge.clear();
      armVerdict();
    },
    useCookieTransport() {
      // Never drop an existing bearer session before the request replacing it
      // has succeeded. Re-authentication endpoints may need that authority.
      if (currentToken() !== null) return;
      pendingBindingThumbprint = null;
      setVerdict('cookies');
    },
    completeCookieTransport() {
      setVerdict('cookies');
      setToken(null);
    },
    useBoundBearerTransport(thumbprint, keyIsPersistent) {
      if (!thumbprint) throw new Error('A session proof thumbprint is required.');
      pendingBindingThumbprint = thumbprint;
      // A token must never outlive the private key that makes it usable. When
      // IndexedDB is blocked, both are limited to this tab.
      if (!keyIsPersistent) pendingEphemeral = true;
      setVerdict('bearer');
    },
    endSession: endCurrentSession,
  };
}

/**
 * One store per project, shared by every client in the document.
 *
 * Keyed rather than per-client because React StrictMode double-invokes the memo
 * that builds the client, and a per-client store would let one copy hold the
 * token while the other, the one actually rendering, had none.
 */
const stores = new Map<string, SessionTokenStore>();

export function sessionTokenStore(projectId: string): SessionTokenStore {
  const existing = stores.get(projectId);
  if (existing) return existing;
  const created = createStore(projectId);
  stores.set(projectId, created);
  return created;
}
