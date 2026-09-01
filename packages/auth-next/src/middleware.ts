import { NextResponse, type NextRequest } from 'next/server';
import { decodePublishableKey } from '@authowl/core';
import { sessionCookieName } from '@authowl/core/server';
import { appSessionCookieNames } from './bridge-contract';

/**
 * Emitted once per process, in development only.
 *
 * The doc comment above has always said this is not an authorization boundary,
 * and a doc comment is read by whoever goes looking. This is the one surface
 * AuthOwl ships that LOOKS like auth middleware and verifies nothing, so it
 * says so where someone who did not go looking will see it.
 *
 * It names both remedies because this middleware gates PAGES, and the
 * page-side gate is `auth()`. Pointing a cookie-session app at `requireAuth()`
 * would be sending it to a primitive that wants a bearer token it does not
 * hold.
 *
 * Once per boot, not per request: a per-request warning in a dev server is
 * noise that gets filtered, and filtered warnings are not warnings.
 */
let warnedNotAnAuthorizationBoundary = false;

function warnNotAnAuthorizationBoundary(): void {
  if (warnedNotAnAuthorizationBoundary) return;
  if (process.env.NODE_ENV === 'production') return;
  warnedNotAnAuthorizationBoundary = true;
  console.warn(
    '[authowl] createAuthRedirectMiddleware is a UX redirect, not authorization. '
    + 'It checks that a cookie NAME is present and verifies nothing, so a client '
    + 'can forge it. Gate pages and route handlers with auth(); gate '
    + 'token-bearing API routes with requireAuth() or requirePermission() '
    + 'from @authowl/core/server. '
    + 'This warning is development-only and appears once.',
  );
}

/**
 * Optional middleware factory for consumer Next.js apps that want to gate
 * routes by likely session presence for UX redirects only. This is not an
 * authorization boundary: a client can forge a cookie with the expected name,
 * and this helper does not validate it with the auth server.
 *
 * Always enforce authorization with `auth()` in the page or route handler. The
 * default matcher protects all paths except loginPath and common static/public
 * paths; callers can override that by passing protectedPaths explicitly.
 */
export function createAuthRedirectMiddleware(opts: {
  publishableKey: string;
  loginPath?: string;
  protectedPaths?: RegExp[];
}) {
  warnNotAnAuthorizationBoundary();
  const { projectId } = decodePublishableKey(opts.publishableKey);
  // UX-only: this middleware has no auth API URL, so it cannot know whether the
  // server issues secure (__Secure-) cookies. Check both variants - a false
  // positive only affects a redirect decision, never authorization (auth()
  // re-validates server-side).
  const bridgeNames = appSessionCookieNames(projectId);
  const cookieNames = [
    ...[true, false].map((secure) => sessionCookieName(projectId, { secure })),
    bridgeNames.secure,
    bridgeNames.local,
  ];
  const loginPath = opts.loginPath ?? '/sign-in';
  const normalizedLoginPath =
    loginPath.endsWith('/') && loginPath !== '/' ? loginPath.slice(0, -1) : loginPath;
  const matchers = opts.protectedPaths ?? [/^\/.*/];
  const usesDefaultMatchers = !opts.protectedPaths;

  return function middleware(req: NextRequest) {
    const pathname = req.nextUrl.pathname;
    const isDefaultPublicPath =
      usesDefaultMatchers &&
      (pathname === normalizedLoginPath ||
        (normalizedLoginPath !== '/' && pathname.startsWith(`${normalizedLoginPath}/`)) ||
        pathname.startsWith('/_next/') ||
        pathname === '/favicon.ico');
    if (isDefaultPublicPath) return NextResponse.next();

    const isProtected = matchers.some((re) => re.test(pathname));
    if (!isProtected) return NextResponse.next();
    if (cookieNames.some((name) => req.cookies.has(name))) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = loginPath;
    return NextResponse.redirect(url);
  };
}

/**
 * @deprecated Use createAuthRedirectMiddleware. This compatibility export is a
 * UX redirect helper only and must not be treated as an authorization boundary.
 */
export function createAuthMiddleware(
  opts: Parameters<typeof createAuthRedirectMiddleware>[0],
) {
  return createAuthRedirectMiddleware(opts);
}
