/**
 * @vitest-environment jsdom
 *
 * Real `localStorage` and `sessionStorage`, not stubs: persistence, WHICH store
 * a token lands in, and the failure modes of both are the whole substance of
 * this module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cookieVerdictStorageKey,
  sessionTokenStorageKey,
  sessionTokenStore,
  SESSION_TOKEN_HEADER,
  type SessionTokenStore,
} from './session-token';

/**
 * The trade-off this module exists to make: a Safari user gets a working
 * session, and a Chrome user is not handed a portable credential they never
 * needed. Both halves are pinned here, because getting either wrong is silent -
 * one is a signed-out user, the other is an XSS upgrade.
 */
let counter = 0;
/** A fresh project id per test: the store is a module-level singleton per project. */
const freshProject = () => `project-${(counter += 1)}`;

const withToken = (value: string) => new Headers({ [SESSION_TOKEN_HEADER]: value });

/**
 * What this store would actually put on the wire, read back off a request it
 * decorated - rather than off a getter no production caller uses.
 */
const bearerSentBy = (store: SessionTokenStore): string | null => {
  const headers = new Headers();
  store.declareOn(headers);
  return headers.get('authorization');
};

/**
 * Read the slot production writes, not one spelled out here.
 *
 * Most of the assertions below would fail loudly on a key rename because they
 * pair a null with a non-null on the sibling store. The ones that would not are
 * the all-null ones - "a Chrome user is left holding NOTHING" - and those are
 * precisely the assertions where a false green is an XSS surface rather than a
 * broken session.
 */
const durable = (projectId: string) =>
  localStorage.getItem(sessionTokenStorageKey(projectId));
const perTab = (projectId: string) =>
  sessionStorage.getItem(sessionTokenStorageKey(projectId));

/**
 * What a session read proved about this browser's cookies.
 *
 * Through a read receipt, because that is the only way production records one: a
 * verdict is evidence about the browser only while the session it was measured
 * under is still the session in play.
 */
const measured = (store: SessionTokenStore, cookiesWork: boolean): void =>
  store.beginRead().recordCookieVerdict(cookiesWork);

/**
 * A page RELOAD: a new store built over what the last load left in storage.
 *
 * Spelled as a fresh project id carrying the previous one's slots across,
 * because the store is a module-level singleton per project and asking for the
 * same id hands back the same instance - memory and all, which is precisely what
 * a reload does not keep. The ids are opaque to everything under test; the
 * storage is the whole subject.
 */
function reloadedStore(previous: string): string {
  const next = freshProject();
  const carry = (store: Storage, key: (id: string) => string) => {
    const value = store.getItem(key(previous));
    if (value !== null) store.setItem(key(next), value);
  };
  // `sessionStorage` survives a reload too - it dies with the TAB - so a
  // reload that only carried the durable slot would report a "don't remember
  // me" session as lost when the real browser keeps it.
  carry(localStorage, sessionTokenStorageKey);
  carry(localStorage, cookieVerdictStorageKey);
  carry(sessionStorage, sessionTokenStorageKey);
  return next;
}

beforeEach(() => {
  localStorage.clear();
  // Cleared too. A leftover per-tab token is read FIRST at construction, so a
  // test that only clears `localStorage` inherits the previous one's session and
  // its "don't remember me" placement with it.
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('sessionTokenStore', () => {
  it('asks for a token until it knows whether the cookie survives here', () => {
    const store = sessionTokenStore(freshProject());

    expect(store.wantsToken()).toBe(true);
    expect(store.needsProbe()).toBe(true);
    expect(bearerSentBy(store)).toBeNull();
  });

  it('sends a captured token as a Bearer credential', () => {
    const store = sessionTokenStore(freshProject());
    store.observe(withToken('tok.sig'));

    expect(bearerSentBy(store)).toBe('Bearer tok.sig');
  });

  it('ignores a response that carries no token', () => {
    const store = sessionTokenStore(freshProject());
    store.observe(withToken('tok.sig'));
    store.observe(new Headers());

    // Every response passes through `observe`; a plain one must not wipe the
    // token, or the session would end at the next unrelated request.
    expect(bearerSentBy(store)).toBe('Bearer tok.sig');
  });

  it('holds a captured token in MEMORY until the verdict says storage is needed', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);

    store.observe(withToken('tok.sig'));

    // The security half, and the one that used to be inverted: the token was
    // written the moment it was captured, on every browser, because the verdict
    // is not knowable then. Every cross-site sign-in therefore left a
    // script-readable session token on disk on Chrome and Firefox too, until a
    // session read happened to complete the measurement - and an app that never
    // subscribed to the session store never had one, so the copy was permanent.
    expect(durable(projectId)).toBeNull();
    expect(perTab(projectId)).toBeNull();
    // The session itself is unaffected. It is in memory, and every request in
    // this document carries it.
    expect(bearerSentBy(store)).toBe('Bearer tok.sig');
  });

  it('asks to be measured the moment it captures a token it cannot judge', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    const measure = vi.fn();
    store.measureWith(measure);

    store.observe(withToken('tok.sig'));

    // The gate above is only safe if the question actually gets asked. Waiting
    // for the host app to read the session is what left a broken-cookie browser
    // holding a token it was never allowed to write - a session that dies at the
    // next reload, on the browsers this transport exists for.
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed measurement break the sign-in that asked for it', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.measureWith(() => {
      throw new Error('the probe could not be dispatched');
    });

    // This runs inside the response that minted the token. An escaping error
    // fails a sign-in that has already succeeded on the server, which is a much
    // worse outcome than a browser going unmeasured until the next page load.
    expect(() => store.observe(withToken('tok.sig'))).not.toThrow();
    expect(bearerSentBy(store)).toBe('Bearer tok.sig');
  });

  it('asks on a reload that finds a token no verdict accounts for', () => {
    const projectId = freshProject();
    // What a build from before the gate left behind, and what a reload during a
    // re-authentication leaves legitimately: `beginSession` re-arms the verdict
    // without dropping the token the door may still need.
    localStorage.setItem(sessionTokenStorageKey(projectId), 'leaked.sig');
    const measure = vi.fn();

    sessionTokenStore(projectId).measureWith(measure);

    // Settled at THIS page load rather than at the next sign-in. On the
    // integrations that produce this state there may not be a next sign-in: the
    // leaked token is the live session and the app simply keeps using it.
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('carries a broken-cookie session through the reload it exists for', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.beginSession({ remember: true });
    store.observe(withToken('tok.sig'));
    expect(durable(projectId)).toBeNull();

    // Safari inside the no-CHIPS window: the detached read found nothing, so the
    // cookie is proven gone and the token stops being a risk and starts being
    // the only copy of this session the browser has.
    measured(store, false);

    const reloaded = sessionTokenStore(reloadedStore(projectId));
    expect(bearerSentBy(reloaded)).toBe('Bearer tok.sig');
    // And it arrives already measured, so the reload spends no probe and the
    // first request is not anonymous.
    expect(reloaded.needsProbe()).toBe(false);
    expect(reloaded.wantsToken()).toBe(true);
  });

  it('does not record a verdict measured under a session that has since ended', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.beginSession({ remember: true });
    store.observe(withToken('first.sig'));
    // A probe dispatched for that session, with the token deliberately detached.
    const measurement = store.beginRead();

    // The user signs out and straight back in, which fits inside one probe's
    // round trip. The probe now answers about the gap in between.
    store.endSession();
    store.beginSession({ remember: true });
    store.observe(withToken('second.sig'));
    measurement.recordCookieVerdict(false);

    // Acting on it would record `bearer` on a browser whose cookies are fine and
    // write the token it just captured to disk under that - the exact defect the
    // gate exists to remove, reintroduced through a race and sticky until the
    // sign-in after next, because a `bearer` verdict makes every read carry the
    // token and no read ever measures again.
    expect(durable(projectId)).toBeNull();
    expect(perTab(projectId)).toBeNull();
    expect(store.needsProbe()).toBe(true);
  });

  it('DROPS the token, and stops asking, once cookies are proven to work', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.observe(withToken('tok.sig'));

    measured(store, true);

    // The security half. A Chrome or Firefox user must end up with no
    // script-readable credential at all, and nothing persisted to find later.
    expect(bearerSentBy(store)).toBeNull();
    expect(store.wantsToken()).toBe(false);
    expect(store.needsProbe()).toBe(false);
    expect(durable(projectId)).toBeNull();
    expect(perTab(projectId)).toBeNull();
  });

  it('KEEPS the token when the cookie did not survive', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.observe(withToken('tok.sig'));

    measured(store, false);

    // The Safari half. Without persistence the session would die on reload,
    // which is the failure this whole transport exists to remove.
    expect(durable(projectId)).toBe('tok.sig');
    expect(bearerSentBy(store)).toBe('Bearer tok.sig');
  });

  it('re-measures a browser whose stored token has no stored verdict', () => {
    const projectId = freshProject();
    localStorage.setItem(sessionTokenStorageKey(projectId), 'from-last-load');

    const reloaded = sessionTokenStore(projectId);

    expect(bearerSentBy(reloaded)).toBe('Bearer from-last-load');
    // The verdict used to be INFERRED from a stored token, which made a dead
    // credential answer a question about the browser: a session that expired
    // server-side left a token behind, that token read back as "measured,
    // bearer", and `needsProbe()` was false forever after - so the next sign-in
    // captured a token nothing persisted and the reload after it restored the
    // dead one. A token is not a verdict.
    expect(reloaded.needsProbe()).toBe(true);
  });

  it('reads a stored verdict of its own, both ways', () => {
    const cookieProject = freshProject();
    localStorage.setItem(cookieVerdictStorageKey(cookieProject), 'ok');
    const bearerProject = freshProject();
    localStorage.setItem(cookieVerdictStorageKey(bearerProject), 'bearer');
    localStorage.setItem(sessionTokenStorageKey(bearerProject), 'from-last-load');

    // Surviving a RELOAD is what spares a Chrome user a token on every page
    // load, and a Safari user a probe on every one.
    expect(sessionTokenStore(cookieProject).wantsToken()).toBe(false);
    expect(sessionTokenStore(cookieProject).needsProbe()).toBe(false);
    expect(sessionTokenStore(bearerProject).wantsToken()).toBe(true);
    expect(sessionTokenStore(bearerProject).needsProbe()).toBe(false);
  });

  it('re-measures at the next sign-in, so a browser that changed can recover', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    // Safari 18.4, where `Partitioned` works: measured, token dropped.
    measured(store, true);
    expect(store.wantsToken()).toBe(false);

    // The user takes the 18.5 point release, which REMOVED CHIPS, and signs in.
    store.beginSession({ remember: true });

    // A verdict that survived this would end the transport: no declaration, so
    // no token can be minted, so every request after a 200 sign-in is anonymous
    // - permanently, and recoverable only by clearing site data.
    expect(store.wantsToken()).toBe(true);
    expect(store.needsProbe()).toBe(true);
    expect(localStorage.getItem(cookieVerdictStorageKey(projectId))).toBeNull();
  });

  it('does not drop the credential the minting request itself needs', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.observe(withToken('pending.sig'));

    // Several minting doors run ON a session: the 2FA verifies upgrade a pending
    // one, phone and email OTP verification can run signed in. Dropping the
    // token here would send the very request that needs it out anonymous, and
    // would sign a user out locally for mistyping a password at a re-auth
    // prompt.
    store.beginSession({ remember: true });

    expect(bearerSentBy(store)).toBe('Bearer pending.sig');
  });

  it('ends the session on sign-out, measurement included', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.observe(withToken('tok.sig'));
    measured(store, true);

    store.endSession();

    expect(bearerSentBy(store)).toBeNull();
    expect(durable(projectId)).toBeNull();
    expect(perTab(projectId)).toBeNull();
    // The verdict goes with the session it was measured under. Keeping the
    // proven-good one looks like it only saves a Chrome user a token, but it is
    // also what pinned a Safari 18.4 user to a transport their 18.5 upgrade
    // broke: no measurement is ever taken again.
    expect(store.wantsToken()).toBe(true);
    expect(store.needsProbe()).toBe(true);
  });

  it('leaves a newer session alone when a stale read reports the old one gone', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.beginSession({ remember: true });
    store.observe(withToken('old.sig'));
    const read = store.beginRead();

    // A session read that started before the sign-in resolves after it: `observe`
    // runs inside the fetch decorator, while the post-mutation refresh only
    // fires once the action resolves, so the two do overlap.
    store.beginSession({ remember: true });
    store.observe(withToken('fresh.sig'));
    read.endIfDead();

    expect(bearerSentBy(store)).toBe('Bearer fresh.sig');
  });

  it('keeps a door\'s "don\'t remember me" intent through a dead read', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.observe(withToken('expired.sig'));
    const read = store.beginRead();

    // The user's old session has expired, and while the read proving it is still
    // open they sign in again with remember-me UNCHECKED. The token has not
    // moved yet - it only moves when the new one arrives - so no comparison of
    // values can tell this apart from a quiet expiry, and only the lifecycle can.
    store.beginSession({ remember: false });
    read.endIfDead();
    store.observe(withToken('fresh.sig'));
    // Placement is only observable once something is placed, and nothing is
    // until the cookie is proven gone. The intent has to survive to here.
    measured(store, false);

    // Ending the session here would have cleared the door's intent, and the
    // token arriving a moment later would land in durable storage: a session the
    // user asked not to have kept, silently outliving the tab.
    expect(perTab(projectId)).toBe('fresh.sig');
    expect(durable(projectId)).toBeNull();
  });

  it('does not clear the token another tab wrote while this one was reading', () => {
    const projectId = freshProject();
    // This tab (B) is signed in and measured, and dispatches a session read.
    const store = sessionTokenStore(projectId);
    store.observe(withToken('tab-b.sig'));
    measured(store, false);
    const read = store.beginRead();
    expect(read.carriedToken).toBe(true);

    // Tab A signs out and back in, which is what put B's read in flight in the
    // first place: A's sign-out ping wakes B, and A's sign-in ping JOINS the
    // read it woke rather than superseding it. A's new session lands in shared
    // storage, which B has no copy of.
    localStorage.setItem(sessionTokenStorageKey(projectId), 'tab-a.sig');

    // B's read answers "no session" - correctly, about the token B presented.
    read.endIfDead();

    // B's generation never moved, so a per-tab guard passes and B wipes the
    // credential A is running on. A keeps working off its in-memory copy and
    // discovers it is signed out at the next reload, with nothing anywhere
    // saying why. The measurement A just took goes the same way.
    expect(durable(projectId)).toBe('tab-a.sig');
    expect(localStorage.getItem(cookieVerdictStorageKey(projectId))).toBe('bearer');
  });

  it('does not flush its stale token over the session another tab just minted', () => {
    const projectId = freshProject();
    // Tab B is signed in, still unmeasured, with a probe in flight. The probe is
    // the receipt: it closed over the token B held when it was dispatched.
    const store = sessionTokenStore(projectId);
    store.beginSession({ remember: true });
    store.observe(withToken('tab-b-old.sig'));
    const probe = store.beginRead();

    // Tab A signs out and back in inside that round trip - both fit - and A's
    // fresh session lands in the slot the two tabs share. B's generation never
    // moves, because none of that happened in B.
    localStorage.setItem(sessionTokenStorageKey(projectId), 'tab-a-new.sig');

    // B's probe answers: this browser drops our cookie. That verdict is TRUE -
    // it is a fact about the browser, and both tabs are the same browser - so it
    // is recorded. The write it unlocks is the part that is a round trip stale.
    probe.recordCookieVerdict(false);

    // Unguarded, this wrote `tab-b-old.sig` over `tab-a-new.sig`, and the damage
    // did not stop there: B's next dead read then hydrated back the token B had
    // just written, so the cross-tab guard in `endIfDead` compared equal, the
    // generation matched, and the slot was wiped in every tab. A finds out at
    // its next reload, with nothing anywhere saying why.
    expect(durable(projectId)).toBe('tab-a-new.sig');
    // And B adopts it rather than sitting on a token the server has forgotten,
    // which is the other half of the same fix.
    expect(bearerSentBy(store)).toBe('Bearer tab-a-new.sig');
    // The verdict still lands: a browser measured through the wrong session's
    // token is still this browser.
    expect(store.needsProbe()).toBe(false);
    expect(localStorage.getItem(cookieVerdictStorageKey(projectId))).toBe('bearer');
  });

  it('drops its own stale copy when it finds a newer session in storage', () => {
    const projectId = freshProject();
    const store = sessionTokenStore(projectId);
    store.observe(withToken('tab-b.sig'));
    const read = store.beginRead();
    localStorage.setItem(sessionTokenStorageKey(projectId), 'tab-a.sig');

    read.endIfDead();

    // The other half of the same fix, and the one a receipt that simply returns
    // early on a mismatch leaves broken. Today the wipe is what nulls memory as
    // a side effect, so declining to wipe has to null it deliberately - or this
    // tab presents a token the server has already forgotten on every request
    // until it is reloaded.
    expect(bearerSentBy(store)).toBe('Bearer tab-a.sig');
  });

  /**
   * Every test here measures the cookie as BROKEN before reading storage, and
   * that is not ceremony: placement is only observable once something is placed,
   * and nothing is placed on a browser that has another way to keep a session.
   * The intent therefore has to survive from the door that declared it all the
   * way to the verdict, which is a longer trip than it used to be.
   */
  describe('remember me, which no cookie can carry on this transport', () => {
    it('keeps a declined session out of durable storage', () => {
      const projectId = freshProject();
      const store = sessionTokenStore(projectId);

      store.beginSession({ remember: false });
      store.observe(withToken('tok.sig'));
      measured(store, false);

      // WHICH store is the whole answer here: no cookie can carry the choice on
      // this transport, so placement is the only thing honouring it.
      // `SessionStart.remember` in `session-token.ts` owns why.
      expect(perTab(projectId)).toBe('tok.sig');
      expect(durable(projectId)).toBeNull();
    });

    it('starts each session from the default rather than the last one', () => {
      const projectId = freshProject();
      const store = sessionTokenStore(projectId);
      store.beginSession({ remember: false });
      store.observe(withToken('ephemeral.sig'));
      store.endSession();

      // A door with no `rememberMe` of its own - email OTP, phone OTP, the
      // cross-site exchange. Inheriting the last session's answer is how a user
      // who once declined stays un-remembered forever, signed out by every tab
      // close with nothing to explain it.
      store.beginSession({ remember: true });
      store.observe(withToken('durable.sig'));
      measured(store, false);

      expect(durable(projectId)).toBe('durable.sig');
      expect(perTab(projectId)).toBeNull();
    });

    it('forgets where the ended session was kept', () => {
      const projectId = freshProject();
      const store = sessionTokenStore(projectId);
      store.beginSession({ remember: false });
      store.observe(withToken('tok.sig'));
      store.endSession();

      // A token arriving with no door having begun a session - a rotation, an
      // out-of-band capture - must not inherit the placement of the session that
      // is over. `ephemeral` describes a session, and this one ended.
      store.observe(withToken('rotated.sig'));
      measured(store, false);

      expect(durable(projectId)).toBe('rotated.sig');
      expect(perTab(projectId)).toBeNull();
    });

    it('does not move an existing token for an attempt that mints nothing', () => {
      const projectId = freshProject();
      const store = sessionTokenStore(projectId);
      store.beginSession({ remember: false });
      store.observe(withToken('tok.sig'));
      measured(store, false);

      // A signed-in "don't remember me" user mistypes an OTP. The door declared
      // the default, but no token arrived, so nothing about the session they are
      // actually in may change - the re-armed verdict included, which must not
      // take the storage of the session they are still in with it.
      store.beginSession({ remember: true });

      expect(perTab(projectId)).toBe('tok.sig');
      expect(durable(projectId)).toBeNull();
    });
  });

  it('picks up a session another tab established', () => {
    const projectId = freshProject();
    // This tab was already open, so it read storage at construction and found
    // nothing.
    const store = sessionTokenStore(projectId);
    expect(bearerSentBy(store)).toBeNull();

    localStorage.setItem(sessionTokenStorageKey(projectId), 'from-another-tab');

    // The cross-tab ping carries no credential, deliberately, so this tab has to
    // find the session itself. Without the fallthrough it refreshes with none,
    // gets an anonymous answer, and - because the measurement only runs on a read
    // that FOUND a session - stays signed out until it is reloaded, while the
    // cookie transport would have shared the session for free.
    expect(bearerSentBy(store)).toBe('Bearer from-another-tab');
    expect(store.hasToken()).toBe(true);
  });

  it('survives storage that throws, which is where it is needed most', () => {
    // Safari in private browsing, an embedded webview, a strict storage policy -
    // the same populations that need the token. A throw here must cost the user
    // persistence across reloads, not the ability to sign in.
    const projectId = freshProject();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const store = sessionTokenStore(projectId);
    store.observe(withToken('tok.sig'));

    expect(() => measured(store, false)).not.toThrow();
    expect(bearerSentBy(store)).toBe('Bearer tok.sig');
  });

  it('gives one store per project, shared by every client in the document', () => {
    const projectId = freshProject();
    sessionTokenStore(projectId).observe(withToken('tok.sig'));

    // StrictMode double-invokes the memo that builds the client. A per-client
    // store would leave the copy that actually renders holding no token.
    expect(bearerSentBy(sessionTokenStore(projectId))).toBe('Bearer tok.sig');
    expect(bearerSentBy(sessionTokenStore(freshProject()))).toBeNull();
  });
});
