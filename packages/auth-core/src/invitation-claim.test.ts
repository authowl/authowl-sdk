/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureInvitationClaim,
  clearInvitationClaim,
  INVITATION_CLAIM_MAX_AGE_MS,
  readInvitationClaim,
} from './invitation-claim';

/**
 * The claim exists because the query parameter dies at the first redirect of the
 * sign-up the invitee has to complete first. These cover the capture, the strip,
 * and the refusals - a stashed claim is later handed to `accept-invitation`, so
 * what may enter storage is worth pinning.
 */

function visit(search: string): void {
  window.history.replaceState({}, '', `/team${search}`);
}

beforeEach(() => {
  localStorage.clear();
  visit('');
});

describe('captureInvitationClaim', () => {
  it('captures the id, strips only our parameter, and survives the URL', () => {
    visit('?authowl_invitation=inv_123&page=2');

    const claim = captureInvitationClaim(1_000);

    expect(claim).toEqual({ id: 'inv_123', capturedAt: 1_000 });
    // The tenant's own parameters are not ours to rewrite.
    expect(window.location.search).toBe('?page=2');
    expect(readInvitationClaim(1_000)).toEqual({ id: 'inv_123', capturedAt: 1_000 });
  });

  it('captures the new-user hint and strips it with the id', () => {
    visit('?authowl_invitation=inv_123&authowl_hint=new_user&page=2');
    const claim = captureInvitationClaim();
    expect(claim).toMatchObject({ id: 'inv_123', recipientHint: 'new_user' });
    expect(window.location.search).toBe('?page=2');
  });

  it('ignores a hint value it does not understand', () => {
    // The parameter is attacker-reachable. Only the one value we defined counts;
    // anything else is not a hint, and is still stripped rather than left in the
    // tenant's URL.
    visit('?authowl_invitation=inv_123&authowl_hint=existing_user');
    const claim = captureInvitationClaim();
    expect(claim?.id).toBe('inv_123');
    expect(claim).not.toHaveProperty('recipientHint');
    expect(window.location.search).toBe('');
  });

  it('strips a stray hint that arrived without an invitation', () => {
    visit('?authowl_hint=new_user&page=2');
    expect(captureInvitationClaim()).toBeNull();
    expect(window.location.search).toBe('?page=2');
  });

  it('reads back a claim stashed before the hint existed', () => {
    // Absence is a valid claim, not a corrupt one - it must not be discarded.
    window.localStorage.setItem(
      'authowl.invitation-claim',
      JSON.stringify({ id: 'inv_old', capturedAt: Date.now() }),
    );
    const claim = readInvitationClaim();
    expect(claim?.id).toBe('inv_old');
    expect(claim).not.toHaveProperty('recipientHint');
  });

  it('returns the stashed claim when the URL carries no parameter', () => {
    visit('?authowl_invitation=inv_stashed');
    captureInvitationClaim(1_000);
    visit('/verify-email');

    expect(captureInvitationClaim(2_000)).toEqual({ id: 'inv_stashed', capturedAt: 1_000 });
  });

  it('strips but refuses a malformed id, leaving no claim', () => {
    visit('?authowl_invitation=' + encodeURIComponent('../../etc/passwd'));

    expect(captureInvitationClaim(1_000)).toBeNull();
    expect(window.location.search).toBe('');
    expect(localStorage.getItem('authowl.invitation-claim')).toBeNull();
  });

  it('drops a claim older than the maximum age', () => {
    visit('?authowl_invitation=inv_old');
    captureInvitationClaim(1_000);

    expect(readInvitationClaim(1_000 + INVITATION_CLAIM_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem('authowl.invitation-claim')).toBeNull();
  });

  it('discards unreadable storage rather than throwing', () => {
    localStorage.setItem('authowl.invitation-claim', 'not json');
    expect(readInvitationClaim(1_000)).toBeNull();

    localStorage.setItem('authowl.invitation-claim', JSON.stringify({ id: 42 }));
    expect(readInvitationClaim(1_000)).toBeNull();
  });

  it('clears on request', () => {
    visit('?authowl_invitation=inv_clear');
    captureInvitationClaim(1_000);
    clearInvitationClaim();
    expect(readInvitationClaim(1_000)).toBeNull();
  });
});
