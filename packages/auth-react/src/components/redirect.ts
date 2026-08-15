/**
 * Client-side redirect safety, shared by every SDK path that navigates after an
 * auth transition (sign-in success, sign-out). Unlike server-mediated
 * `callbackURL` flows (which the server origin-checks), these run
 * `window.location.assign` verbatim, so a target derived from an untrusted query
 * param must not become an open redirect to an external site.
 */

/**
 * Only same-origin or relative targets are considered safe. Cross-origin,
 * protocol-relative (`//evil.com`), and non-http(s) schemes (`javascript:`,
 * `data:`) all resolve to a different origin and are refused.
 */
export function isSafeRedirect(redirectTo: string, origin: string): boolean {
  try {
    return new URL(redirectTo, origin).origin === origin;
  } catch {
    return false;
  }
}

/** Navigate to a same-origin target and report whether navigation was started. */
export function safeRedirect(redirectTo: string | undefined): boolean {
  if (redirectTo && isSafeRedirect(redirectTo, window.location.origin)) {
    window.location.assign(redirectTo);
    return true;
  }
  return false;
}
