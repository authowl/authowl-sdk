import { describe, expect, it } from 'vitest';
import { sessionCookieName } from './cookie';

// Fixtures verified 2026-07-06 against the auth engine's getCookies() run with the
// server's real project-factory config (advanced.cookiePrefix = `p_<id no
// dashes>`, useSecureCookies in prod). See CONTRACTS section 5. If a Better
// Auth upgrade changes cookie naming, re-verify and update these fixtures, the
// sessionCookieName implementation, and CONTRACTS together.
describe('sessionCookieName', () => {
  const projectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const idNoDashes = 'a1b2c3d4e5f67890abcdef1234567890';

  it('derives the dev cookie name (no secure prefix, dot separator)', () => {
    expect(sessionCookieName(projectId)).toBe(`p_${idNoDashes}.session_token`);
    expect(sessionCookieName(projectId, { secure: false })).toBe(`p_${idNoDashes}.session_token`);
  });

  it('derives the production cookie name (__Secure- prefix)', () => {
    expect(sessionCookieName(projectId, { secure: true })).toBe(
      `__Secure-p_${idNoDashes}.session_token`,
    );
  });

  it('strips dashes from the project id and joins with a dot', () => {
    const name = sessionCookieName(projectId);
    expect(name).not.toContain('-');
    expect(name).toContain('.session_token');
    expect(name).not.toContain('_session_token');
  });

  // NOTE: the project-id CASE rule is deliberately not asserted here. It is
  // owned by `conformance/vectors/cookie-name.json`, which pins a mixed-case id
  // to the exact lowercase name in both cookie modes and is re-verified by all
  // six SDKs - including this package, via `conformance.test.ts`, in this same
  // vitest run. A copy here would be a second owner that CI cannot tell has
  // drifted. Add case behaviour to the vectors, not to this file.
});
