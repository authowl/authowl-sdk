import { describe, expect, it } from 'vitest';
import { sessionAuthState } from './auth-state';
import type { AuthSession, AuthUser } from '@authowl/core';

const user = { id: 'u1', email: 'a@b.co' } as AuthUser;
const session = (pendingMfaEnrollment?: boolean | null) =>
  ({ id: 's1', userId: 'u1', pendingMfaEnrollment }) as AuthSession;

describe('sessionAuthState (the pending-MFA client policy, CONTRACTS §5)', () => {
  it('a normal session is signed in', () => {
    expect(sessionAuthState({ user, session: session(false) })).toEqual({
      isSignedIn: true,
      needsMfaEnrollment: false,
    });
    // Servers without the field (pre-B.5c) behave identically.
    expect(sessionAuthState({ user, session: session(undefined) }).isSignedIn).toBe(true);
    expect(sessionAuthState({ user, session: session(null) }).isSignedIn).toBe(true);
  });

  it('a held session is UNAUTHENTICATED for the app, but routed to enrolment', () => {
    expect(sessionAuthState({ user, session: session(true) })).toEqual({
      isSignedIn: false,
      needsMfaEnrollment: true,
    });
  });

  it('signed out is neither', () => {
    expect(sessionAuthState(null)).toEqual({ isSignedIn: false, needsMfaEnrollment: false });
    expect(sessionAuthState(undefined)).toEqual({ isSignedIn: false, needsMfaEnrollment: false });
  });
});
