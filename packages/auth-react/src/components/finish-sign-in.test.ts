// @vitest-environment jsdom
import type { AuthSession, AuthUser, SessionState, SessionStore } from '@authowl/core';
import { describe, expect, it, vi } from 'vitest';
import { finishSignIn } from './finish-sign-in';

function sessionStore(): {
  store: SessionStore;
  authenticate: () => void;
  holdAtEnrollment: () => void;
  listenerCount: () => number;
} {
  const listeners = new Set<() => void>();
  let state: SessionState = {
    data: null,
    isPending: true,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  };
  const settle = (session: Partial<AuthSession>) => {
    state = {
      ...state,
      data: {
        user: { id: 'user-1' } as AuthUser,
        session: { id: 'session-1', ...session } as AuthSession,
      },
      isPending: false,
    };
    for (const listener of listeners) listener();
  };
  return {
    store: {
      getSnapshot: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    authenticate: () => settle({}),
    // What a required-MFA project returns for a correct password from a
    // factor-less user: a real session, held until they enrol.
    holdAtEnrollment: () => settle({ pendingMfaEnrollment: true }),
    listenerCount: () => listeners.size,
  };
}

describe('finishSignIn', () => {
  it('waits for the reactive session before notifying, then resolves', async () => {
    const session = sessionStore();
    const onSignedIn = vi.fn();
    let settled = false;
    const finishing = finishSignIn({ sessionStore: session.store, onSignedIn })
      .then(() => { settled = true; });

    // Notifying here would be premature: the outcome is not known yet, and a
    // held session must NOT reach the caller. (This assertion previously
    // expected the opposite, which is what let the required-MFA hold navigate
    // apps away from their own enrolment screen.)
    await Promise.resolve();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(session.listenerCount()).toBe(1);

    session.authenticate();
    await finishing;
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    expect(session.listenerCount()).toBe(0);
  });

  it('resolves immediately when the session store is already authenticated', async () => {
    const session = sessionStore();
    session.authenticate();
    const onSignedIn = vi.fn();
    await expect(
      finishSignIn({ sessionStore: session.store, onSignedIn }),
    ).resolves.toBeUndefined();
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(session.listenerCount()).toBe(0);
  });

  // The second half of the required-MFA lockout. <SignIn/> can render the
  // enrolment step, but only while it is still mounted - and the typical
  // onSignedIn callback navigates, unmounting it. Notifying on a held session
  // therefore destroys the surface that was about to finish enrolment, and the
  // user lands back on a signed-out page having done nothing wrong.
  it('does not notify the caller when the session is held at MFA enrolment', async () => {
    const session = sessionStore();
    const onSignedIn = vi.fn();
    const finishing = finishSignIn({ sessionStore: session.store, onSignedIn });

    session.holdAtEnrollment();
    await finishing;

    expect(onSignedIn).not.toHaveBeenCalled();
    expect(session.listenerCount()).toBe(0);
  });

  it('does not notify for a session already held at enrolment before the wait', async () => {
    const session = sessionStore();
    session.holdAtEnrollment();
    const onSignedIn = vi.fn();

    await finishSignIn({ sessionStore: session.store, onSignedIn });

    expect(onSignedIn).not.toHaveBeenCalled();
  });

  // `redirectTo` is the same hazard with the browser doing the unmounting.
  it('does not redirect away from a held session', async () => {
    const session = sessionStore();
    session.holdAtEnrollment();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, href: 'http://localhost/' },
    });

    try {
      await finishSignIn({ sessionStore: session.store, redirectTo: '/dashboard' });
      expect(assign).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
