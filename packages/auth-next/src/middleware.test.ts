import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { createAuthRedirectMiddleware } from './middleware';
import { appSessionCookieNames } from './bridge-contract';

/**
 * THE DOOR THAT DOES NOT USE THE DECODER.
 *
 * `createAuthRedirectMiddleware` reaches a project id with
 * `publishableKey.split('_')[2]` and never calls `decodePublishableKey`, so a
 * fix applied at the decoder would leave this entry point still deriving a
 * cookie name from raw, un-canonicalised text. That is why `sessionCookieName`
 * canonicalises instead, and why this suite exists: it exercises the real
 * middleware through the real split, not the derivation in isolation.
 */

// The uuid with its hex upper-cased. Structurally VALID - every AuthOwl key
// grammar accepts `[0-9a-fA-F-]` in the uuid segment - so this needs no
// hand-typing to occur; a case-mangling copy of a real key produces it.
const PROJECT_ID_MIXED = '2F1C9A84-6B3D-4E57-9A10-5C8D7E2B4F60';
const MIXED_CASE_KEY = `pk_live_${PROJECT_ID_MIXED}_A1b2C3d4E5f6G7h8I9j0`;
const LOWER_CASE_KEY = `pk_live_${PROJECT_ID_MIXED.toLowerCase()}_A1b2C3d4E5f6G7h8I9j0`;

// What the server ACTUALLY sets: the prefix is built from `projects.id`, a
// Postgres `uuid`, which always renders lowercase.
const SERVER_COOKIE = 'p_2f1c9a846b3d4e579a105c8d7e2b4f60.session_token';
const SERVER_COOKIE_SECURE = `__Secure-${SERVER_COOKIE}`;

const request = (cookie: string) =>
  new NextRequest('https://app.example.com/dashboard', { headers: { cookie } });

describe('createAuthRedirectMiddleware project-id case', () => {
  // Both key spellings x both cookie modes. The lowercase rows are the baseline
  // the mixed-case rows are claimed to match, asserted directly against the name
  // the server sets rather than by comparing the two middlewares to each other -
  // a regression that upper-cased BOTH sides would satisfy that comparison.
  it.each([
    ['mixed-case key, insecure', MIXED_CASE_KEY, SERVER_COOKIE],
    ['mixed-case key, secure', MIXED_CASE_KEY, SERVER_COOKIE_SECURE],
    ['lowercase key, insecure', LOWER_CASE_KEY, SERVER_COOKIE],
    ['lowercase key, secure', LOWER_CASE_KEY, SERVER_COOKIE_SECURE],
  ])('recognises the cookie the server set (%s)', (_case, publishableKey, cookieName) => {
    const middleware = createAuthRedirectMiddleware({ publishableKey });
    const res = middleware(request(`${cookieName}=tok_1`));

    // A redirect here is the bug: the cookie IS present, so the only way the
    // middleware misses it is by searching for a name the server never set.
    // The failure is silent in production - the user signed in a moment ago and
    // gets bounced back to /sign-in with nothing logged anywhere.
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still redirects when no session cookie is present', () => {
    const middleware = createAuthRedirectMiddleware({ publishableKey: MIXED_CASE_KEY });
    const res = middleware(request('unrelated=1'));

    // Guards the assertion above: if the middleware let everything through, the
    // "recognises the cookie" cases would pass without proving anything.
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in');
  });

  it.each(['secure', 'local'] as const)(
    'recognises the %s app-origin bridge cookie for UX routing',
    (mode) => {
      const middleware = createAuthRedirectMiddleware({ publishableKey: MIXED_CASE_KEY });
      const cookieName = appSessionCookieNames(PROJECT_ID_MIXED)[mode];
      const res = middleware(request(`${cookieName}=bridge-token.sig`));

      expect(res.status).not.toBe(307);
      expect(res.headers.get('location')).toBeNull();
    },
  );
});
