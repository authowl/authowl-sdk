/**
 * Whether an in-progress MFA enrolment must be discarded because the signed-in
 * identity changed. A TOTP URI + one-time backup codes belong to the account that
 * started enrolment; if that user signs out or another account signs in while the
 * enrolment component stays mounted, those secrets must NOT linger on screen for
 * the new session. A benign same-user session refetch keeps `currentUserId`, so
 * the flow survives it (the QR + backup codes are not dropped mid-setup).
 *
 * Pure so the security rule is unit-tested without a DOM.
 */
export function shouldDiscardSetup(args: {
  /** Session settled (not mid initial-load); a null user then means signed-out. */
  isLoaded: boolean;
  /** An enrolment is in flight (QR + backup codes are on screen). */
  hasSetup: boolean;
  /** The user id that started the current enrolment. */
  setupOwnerId: string | null;
  /** Who is signed in right now (null once signed out). */
  currentUserId: string | null;
}): boolean {
  const { isLoaded, hasSetup, setupOwnerId, currentUserId } = args;
  return isLoaded && hasSetup && setupOwnerId !== currentUserId;
}
