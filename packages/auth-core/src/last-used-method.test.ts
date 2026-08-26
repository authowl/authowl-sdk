/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  confirmPendingSignInMethod,
  forgetLastUsedSignInMethod,
  lastUsedMethodStorageKey,
  pendingSignInMethodStorageKey,
  readLastUsedSignInMethod,
  recordLastUsedSignInMethod,
  rememberPendingSignInMethod,
} from './last-used-method';

const projectId = '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60';

beforeEach(() => {
  localStorage.clear();
});

describe('remembering which method worked here', () => {
  it('round-trips a method, scoped to its project', () => {
    recordLastUsedSignInMethod(projectId, 'passkey');
    expect(readLastUsedSignInMethod(projectId)).toBe('passkey');
    // A second project in the same browser is a different answer, not a shared one.
    expect(readLastUsedSignInMethod('other-project')).toBeNull();
  });

  it('keeps a social provider distinguishable', () => {
    // "social" alone would point a returning Google user at a row of buttons.
    recordLastUsedSignInMethod(projectId, 'social:google');
    expect(readLastUsedSignInMethod(projectId)).toBe('social:google');
  });

  it('forgets on request', () => {
    recordLastUsedSignInMethod(projectId, 'password');
    forgetLastUsedSignInMethod(projectId);
    expect(readLastUsedSignInMethod(projectId)).toBeNull();
  });

  /**
   * The stored value decides what a form highlights and lives somewhere the
   * user can edit, so anything unrecognised is discarded rather than rendered.
   */
  it.each([
    ['a method that does not exist', 'telepathy'],
    ['an empty value', ''],
    ['a social id with no provider', 'social:'],
    ['a social id shaped like a path', 'social:../../etc'],
    ['something long enough to be an attack', `social:${'a'.repeat(200)}`],
    ['markup', '<img src=x onerror=alert(1)>'],
  ])('discards %s', (_label, hostile) => {
    localStorage.setItem(lastUsedMethodStorageKey(projectId), hostile);
    expect(readLastUsedSignInMethod(projectId)).toBeNull();
  });

  it('never stores anything derived from an identifier', () => {
    // The guarantee this module exists under: what is remembered is a property
    // of the BROWSER, never of an address. "Which method does a@b.com use" is
    // an enumeration surface, and nothing here may be able to answer it.
    recordLastUsedSignInMethod(projectId, 'password');
    const everything = Object.entries(localStorage).map(([k, v]) => `${k}=${v}`).join('\n');
    expect(everything).not.toMatch(/@/);
    expect(everything).toBe(`${lastUsedMethodStorageKey(projectId)}=password`);
  });
});

/**
 * Social and SSO leave the page before anything can observe success, so the
 * attempt is parked and promoted only on return WITH a session.
 */
describe('a redirect method that has not come back yet', () => {
  it('is not reported as used while it is still pending', () => {
    rememberPendingSignInMethod(projectId, 'social:google');
    // The user is at the provider's consent screen. Nothing worked yet.
    expect(readLastUsedSignInMethod(projectId)).toBeNull();
  });

  it('is promoted once a session confirms it', () => {
    rememberPendingSignInMethod(projectId, 'social:google');
    expect(confirmPendingSignInMethod(projectId)).toBe('social:google');
    expect(readLastUsedSignInMethod(projectId)).toBe('social:google');
  });

  it('is cleared by the confirmation, so a later visit cannot promote it twice', () => {
    rememberPendingSignInMethod(projectId, 'sso');
    confirmPendingSignInMethod(projectId);
    forgetLastUsedSignInMethod(projectId);

    // A user who returns much later, signed in from somewhere else entirely,
    // must not have that stale attempt resurrected as "what worked".
    expect(confirmPendingSignInMethod(projectId)).toBeNull();
    expect(readLastUsedSignInMethod(projectId)).toBeNull();
  });

  it('does not overwrite what already worked until it is confirmed', () => {
    recordLastUsedSignInMethod(projectId, 'passkey');
    rememberPendingSignInMethod(projectId, 'social:google');
    // Bounced off the consent screen: passkey is still the truthful answer.
    expect(readLastUsedSignInMethod(projectId)).toBe('passkey');
  });

  it('discards a tampered pending value rather than promoting it', () => {
    localStorage.setItem(pendingSignInMethodStorageKey(projectId), 'social:<script>');
    expect(confirmPendingSignInMethod(projectId)).toBeNull();
    expect(readLastUsedSignInMethod(projectId)).toBeNull();
  });
});
