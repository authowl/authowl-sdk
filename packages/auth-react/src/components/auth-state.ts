import type { AuthSession, AuthUser } from '@authowl/core';

/**
 * THE pending-MFA session policy for the client (CONTRACTS §5), pure and
 * tested: a session held at required-MFA enrolment is treated as
 * UNAUTHENTICATED for app purposes (`isSignedIn` false - <SignedIn/>,
 * <Protect/>, useAuth all inherit it) while `needsMfaEnrollment` routes the
 * user to <MFARequiredGate/>'s enrolment screen.
 */
export function sessionAuthState(
  data: { user: AuthUser; session: AuthSession } | null | undefined,
): { isSignedIn: boolean; needsMfaEnrollment: boolean } {
  const hasUser = !!data?.user;
  const pending = data?.session?.pendingMfaEnrollment === true;
  return {
    isSignedIn: hasUser && !pending,
    needsMfaEnrollment: hasUser && pending,
  };
}
