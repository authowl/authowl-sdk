import { describe, expect, it } from 'vitest';
import { shouldDiscardSetup } from './mfa-enrollment';

/**
 * Guards a security rule: a started MFA enrolment's TOTP secret + backup codes
 * must be dropped the moment the signed-in identity changes, so one account's
 * setup secrets are never shown to another - but a benign same-user refetch must
 * NOT wipe the in-progress QR/backup codes.
 */
describe('shouldDiscardSetup', () => {
  const base = { isLoaded: true, hasSetup: true, setupOwnerId: 'user-a', currentUserId: 'user-a' };

  it('keeps the setup for the same signed-in user (benign refetch)', () => {
    expect(shouldDiscardSetup(base)).toBe(false);
  });

  it('discards when the user signs out (current identity is null)', () => {
    expect(shouldDiscardSetup({ ...base, currentUserId: null })).toBe(true);
  });

  it('discards when a different account signs in', () => {
    expect(shouldDiscardSetup({ ...base, currentUserId: 'user-b' })).toBe(true);
  });

  it('does nothing before the session has settled', () => {
    expect(shouldDiscardSetup({ ...base, isLoaded: false, currentUserId: null })).toBe(false);
  });

  it('does nothing when no enrolment is in flight', () => {
    expect(shouldDiscardSetup({ ...base, hasSetup: false, currentUserId: 'user-b' })).toBe(false);
  });
});
