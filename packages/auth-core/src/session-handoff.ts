import type { ResolvedAuthConfig } from './config';
import type { AuthHttpClient } from './http-client';
import type { SocialSignInOptions, SsoSignInOptions } from './client';
import type { SessionTokenStore } from './session-token';
import { isBrowserRuntime } from './browser-runtime';

/**
 * The client half of AuthOwl's cross-site session transport.
 *
 * A browser stores a cookie under the site that is TOP-LEVEL when the cookie is
 * written. So when a provider redirects back to the auth host, the session (and
 * the OAuth `state` written before it) belong to the auth host, and this app -
 * on another site entirely - can never read them. Safari 18.4+ and
 * Chrome-with-third-party-cookies-off make it worse by dropping the cross-site
 * cookie outright. The visible symptom is sign-in that "works" and a next
 * request that is signed out, or `state_mismatch` on every social attempt.
 *
 * The fix has two halves, and this file is the client's:
 *
 *  1. Start the flow by NAVIGATING to `/auth/session/start` rather than posting
 *     `/sign-in/social` in the background. The state cookie is then written in
 *     the same context the provider's callback will read it from.
 *  2. Come back with a one-time code in the URL fragment, and exchange it for
 *     the session on an ordinary fetch from this page - which is the only
 *     request whose cookies land where this app can read them.
 *
 * The verifier binds the two halves: it is minted here, never leaves this
 * origin, and only its SHA-256 travels. Someone who intercepts the code alone
 * cannot redeem it.
 */
const VERIFIER_COOKIE = 'authowl_handoff_verifier';
const CODE_FRAGMENT_KEY = 'authowl_code';
const VERIFIER_BYTES = 32;
/** Long enough for a provider round trip including a first-time signup, short enough to matter. */
const VERIFIER_TTL_SECONDS = 15 * 60;

/** The fields the server resolves an SSO connection from. Derived, so it cannot drift. */
type SsoSelectors = Pick<SsoSignInOptions, 'email' | 'providerId' | 'domain' | 'organizationSlug'>;
const SSO_SELECTORS = ['email', 'providerId', 'domain', 'organizationSlug'] as const;

/** Where the browser lands afterwards. Relative paths resolve against this app. */
type Destinations = Pick<
  SocialSignInOptions,
  'callbackURL' | 'errorCallbackURL' | 'newUserCallbackURL'
>;

/** Provider options the start endpoint forwards to the engine. */
type ProviderOptions = Pick<SocialSignInOptions, 'scopes' | 'loginHint' | 'requestSignUp'>;

export type CrossSiteSignInStart =
  | ({ kind: 'social'; provider: string } & Destinations & ProviderOptions)
  | ({ kind: 'sso' } & SsoSelectors & Destinations);

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * `base64url(SHA-256(verifier))`, unpadded - the same construction as PKCE's
 * S256. It must be an UNKEYED hash: the server compares what it stored against
 * a hash it recomputes from the verifier, and a keyed digest would be something
 * only the server could produce, so no client could ever satisfy it.
 */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function mintVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
}

/**
 * Keep the verifier in a first-party cookie on THIS origin, not in
 * `sessionStorage`.
 *
 * Same security either way - readable by script on this origin, unreadable
 * cross-site - but a cookie survives the provider round trip landing in a
 * different tab, which `sessionStorage` does not. That deletes a whole family of
 * failures (middle-click, `target="_blank"`, an in-app browser handing back to
 * the system one) rather than making each of them its own error path.
 *
 * `SameSite=Lax` is required, not incidental: the browser arrives here by
 * top-level navigation from the auth host, and a `Strict` cookie is withheld on
 * exactly that.
 */
function writeVerifierCookie(value: string, maxAgeSeconds: number): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${VERIFIER_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function readVerifier(): string | null {
  for (const entry of document.cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== VERIFIER_COOKIE) continue;
    return entry.slice(separator + 1).trim() || null;
  }
  return null;
}

function clearVerifier(): void {
  writeVerifierCookie('', 0);
}

/** Absolute, on this app's origin. The server refuses anything that is not an allowed origin. */
function absolute(value: string): string {
  return new URL(value, window.location.href).toString();
}

/**
 * Build the first-party start URL and arm the verifier.
 *
 * The publishable key travels as a query parameter here, and only here: the
 * browser NAVIGATES to this URL, and a navigation cannot carry a header. The key
 * is public by design - it is already readable in this page's bundle - and what
 * actually gates the route is that every destination must be one of the
 * project's allowed origins.
 */
export async function beginCrossSiteSignIn(
  config: ResolvedAuthConfig,
  start: CrossSiteSignInStart,
): Promise<string | null> {
  // The verifier lives in a HOST-ONLY cookie on this page, and it is read again
  // on the destination page. A destination on another origin - a marketing site
  // sending people to the app - could not read it, so the exchange would be
  // refused and the code burned, permanently. Hand that case back to the caller
  // to run the legacy transport, which is what it does today.
  const destination = start.callbackURL ? absolute(start.callbackURL) : null;
  if (destination && new URL(destination).origin !== window.location.origin) return null;

  const verifier = mintVerifier();
  const url = new URL(`${config.projectBaseURL}/session/start`);
  url.searchParams.set('pk', config.publishableKey);
  url.searchParams.set('kind', start.kind);
  if (start.kind === 'social') {
    url.searchParams.set('provider', start.provider);
    // A navigation carries no body, so an array travels comma-separated.
    if (start.scopes?.length) url.searchParams.set('scopes', start.scopes.join(','));
    if (start.loginHint) url.searchParams.set('loginHint', start.loginHint);
    if (start.requestSignUp !== undefined) {
      url.searchParams.set('requestSignUp', start.requestSignUp ? '1' : '0');
    }
  } else {
    for (const field of SSO_SELECTORS) {
      const value = start[field];
      if (value) url.searchParams.set(field, value);
    }
  }
  // The server replaces the destination's fragment with the handoff code, so a
  // fragment on the default would be discarded anyway - drop it here rather than
  // promise the caller something that cannot survive.
  const here = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  url.searchParams.set('cb', destination ?? here);
  for (const [param, value] of [
    ['err', start.errorCallbackURL],
    ['new', start.newUserCallbackURL],
  ] as const) {
    if (value) url.searchParams.set(param, absolute(value));
  }
  url.searchParams.set('challenge', await challengeFor(verifier));

  // Armed only once the URL is built: if anything above throws, no stale
  // verifier is left behind to be matched against a later flow.
  writeVerifierCookie(verifier, VERIFIER_TTL_SECONDS);
  return url.toString();
}

/**
 * Take the handoff code out of the URL, if this page load is a return leg.
 *
 * The fragment is removed from the address bar with `replaceState` before
 * anything is awaited, so a back-navigation cannot re-present a spent code and
 * the value does not sit in the URL while the exchange is in flight. It does NOT
 * hide the code from analytics: `location.href` still contained it when the page
 * loaded, which is what a page-view snippet records. That is what the verifier is
 * for - the code alone is not enough.
 */
export function takeHandoffCode(expectedCode?: string): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.includes(CODE_FRAGMENT_KEY)) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get(CODE_FRAGMENT_KEY);
  if (!code || (expectedCode !== undefined && code !== expectedCode)) return null;

  params.delete(CODE_FRAGMENT_KEY);
  const remaining = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`,
  );
  return code;
}

/**
 * Redeem a handoff code for the session, if this page load carries one.
 *
 * Resolves `true` when a session was established, so the caller knows to fetch
 * it. Every failure resolves `false` rather than throwing: an expired or already
 * redeemed code means "not signed in", which the ordinary session fetch that
 * follows will report on its own. Nothing here is worth an exception a tenant's
 * app has to catch on page load.
 */
export async function completeCrossSiteSignIn(
  http: AuthHttpClient,
  tokens: SessionTokenStore,
  capturedCode?: string,
): Promise<boolean> {
  if (!isBrowserRuntime()) return false;
  const code = capturedCode ?? takeHandoffCode();
  if (!code) return false;
  if (capturedCode) takeHandoffCode(capturedCode);

  const verifier = readVerifier();
  clearVerifier();
  // No verifier, no exchange. The code alone is a bearer credential for a live
  // session: anyone who reads one off a redirect could hand it to a victim, whose
  // browser would redeem it and be signed into the ATTACKER's account. The server
  // refuses this too - both sides, because either one alone is a single point of
  // failure for a login CSRF.
  if (!verifier) return false;
  // A session BEGINS here, and this door matters more than the rest: the code is
  // SINGLE-USE and its response is the only one carrying the session, so an SDK
  // that arrives holding a stale "cookies work here" verdict would not declare
  // the transport, would be handed no token, and would burn the code with
  // neither - unrecoverable short of redoing the whole OAuth round trip.
  //
  // Remembered, because nothing in a redirect flow can say otherwise: there is
  // no `rememberMe` on a social or SSO sign-in, and the engine mints a
  // persistent session for both.
  tokens.beginSession({ remember: true });
  // The shared client, not a bare fetch: this is the one request that
  // establishes the session, so it needs the transport's deadline above all -
  // the first session read awaits this promise, and a hung exchange with no
  // timeout would leave a tenant's app pending forever. It also brings the
  // response size cap, `redirect: 'error'`, the request id, and typed errors,
  // and it never rejects, so there is nothing here to catch.
  const { error } = await http.request('/session/exchange', {
    method: 'POST',
    body: { code, verifier },
  });
  return error === null;
}
