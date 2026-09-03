import type { SessionStore } from '@authowl/core';
import { safeRedirect } from './redirect';

const SESSION_SETTLE_TIMEOUT_MS = 5_000;

/**
 * `held` = the server issued a session that is NOT usable yet: a required-MFA
 * project holds a factor-less user at enrolment. `settled` covers both a usable
 * session and the timeout, which stay on the notify-and-redirect path.
 */
type SessionOutcome = 'settled' | 'held';

function hasUsableSession(store: SessionStore): boolean {
  const data = store.getSnapshot().data;
  return Boolean(data?.user && data.session.pendingMfaEnrollment !== true);
}

function isHeldAtEnrollment(store: SessionStore): boolean {
  const data = store.getSnapshot().data;
  return Boolean(data?.user && data.session.pendingMfaEnrollment === true);
}

function waitForUsableSession(store: SessionStore): Promise<SessionOutcome> {
  const outcome = (): SessionOutcome => (isHeldAtEnrollment(store) ? 'held' : 'settled');
  if (hasUsableSession(store) || isHeldAtEnrollment(store)) {
    return Promise.resolve(outcome());
  }
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(outcome());
    };
    const timeout = window.setTimeout(finish, SESSION_SETTLE_TIMEOUT_MS);
    unsubscribe = store.subscribe(() => {
      if (hasUsableSession(store) || isHeldAtEnrollment(store)) finish();
    });
    if (hasUsableSession(store) || isHeldAtEnrollment(store)) finish();
  });
}

/**
 * Post-sign-in handoff shared by every surface that issues a session (password,
 * email-OTP, passkey, and passkey autofill): wait for the session to settle,
 * then notify the caller and redirect if a *safe* target was given. Keeps the
 * "session issued -> notify -> redirect" contract in one place so it cannot
 * drift between call sites.
 *
 * THE WAIT COMES FIRST, and that ordering is load-bearing. A required-MFA
 * project answers a correct password with a session HELD at enrolment, which is
 * a successful sign-in that is not yet a usable one. Notifying on that hands
 * control to an app whose callback typically navigates - the blog's is
 * `onSignedIn={() => setView({name: 'feed'})}` - which UNMOUNTS the <SignIn/>
 * that was about to render the enrolment step. The user lands on a signed-out
 * page and sees nothing but a flicker, and the enrolment screen only appears if
 * they happen to open sign-in again. Same for `redirectTo`: navigating away from
 * a held session is the identical bug with the browser doing the unmounting.
 *
 * So a held session returns WITHOUT notifying or redirecting, leaving the
 * calling surface mounted to finish enrolment. Every other outcome - usable, or
 * the settle timeout - keeps the previous behaviour exactly.
 */
export async function finishSignIn(opts: {
  sessionStore: SessionStore;
  redirectTo?: string;
  onSignedIn?: () => void;
  /**
   * A step to run on the way out, after the session is usable and BEFORE the
   * caller is notified or the browser navigates - the only window in which a
   * signed-in prompt can be shown by a surface that is about to unmount. Used
   * for the post-sign-in passkey offer; resolve it to continue.
   *
   * Runs only on a session that is genuinely usable. `settled` also covers the
   * five-second timeout, where no session exists and a step that calls the
   * server would just fail.
   */
  interstitial?: () => Promise<void>;
}): Promise<void> {
  if ((await waitForUsableSession(opts.sessionStore)) === 'held') return;
  if (opts.interstitial && hasUsableSession(opts.sessionStore)) await opts.interstitial();
  opts.onSignedIn?.();
  if (safeRedirect(opts.redirectTo)) {
    // Navigation owns the terminal state. Keep the submit promise unresolved so
    // its loading state cannot flash idle before the browser unloads the page.
    await new Promise<void>(() => {});
  }
}
