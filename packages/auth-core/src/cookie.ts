/**
 * The exact session-cookie name the auth server sets for a given project.
 *
 * Single source of truth for the cookie name across the SDK. The server
 * (the AuthOwl server project factory) configures
 * `advanced.cookiePrefix = "p_" + <projectId without dashes>` and
 * `useSecureCookies` in production; the auth engine then names the session
 * cookie `${securePrefix}${cookiePrefix}.session_token`, where `securePrefix`
 * is `__Secure-` for secure cookies and empty otherwise:
 *
 *   dev  (http):  p_<idNoDashes>.session_token
 *   prod (https): __Secure-p_<idNoDashes>.session_token
 *
 * Verified 2026-07-06 against the auth engine's `getCookies()` with the server's
 * real config (see CONTRACTS section 5 and `cookie.test.ts`). Note the engine
 * joins the prefix and name with a dot (`.`), not an underscore, and uses the
 * `__Secure-` (not `__Host-`) prefix - both are easy to get wrong by hand, and
 * getting them wrong makes `auth()` forward a cookie the server never set. If an
 * auth-engine upgrade changes cookie naming, re-verify and update this function,
 * the `cookie.test.ts` fixtures, and CONTRACTS section 5 together.
 *
 * `secure` must reflect the SERVER's cookie mode: callers holding the auth API
 * URL derive it from the protocol (`https:` => secure). Callers that cannot
 * know it (the UX-only redirect middleware) should check both variants.
 */
export function sessionCookieName(projectId: string, opts?: { secure?: boolean }): string {
  // LOWERCASED BECAUSE THE SERVER'S NAME ALWAYS IS. `projects.id` is a Postgres
  // `uuid`, which renders lowercase, and the engine builds `cookiePrefix` from
  // that value - so lowercase is the only prefix any cookie was ever set under.
  // Cookie names are case-SENSITIVE, so a mixed-case id here names a cookie that
  // does not exist: sign-in succeeds, the browser stores the real cookie, and
  // every consumer below then searches for a name nothing has and reports signed
  // out, with nothing in any log to say why. Canonicalising HERE rather than at
  // the decoder is deliberate - `auth-next`'s middleware and `auth()` both reach
  // a project id by splitting the publishable key themselves and never call
  // `decodePublishableKey`, so this derivation is the only chokepoint all callers
  // share.
  const cookiePrefix = `p_${projectId.toLowerCase().replace(/-/g, '')}`;
  const securePrefix = opts?.secure ? '__Secure-' : '';
  return `${securePrefix}${cookiePrefix}.session_token`;
}
