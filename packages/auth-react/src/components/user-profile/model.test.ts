import { describe, expect, it } from 'vitest';
import {
  formatSessionTime,
  sortSessionsByRecency,
  userProfileSectionsFor,
  userProfileSectionFromHash,
  userProfileSectionHash,
} from './model';

describe('UserProfile model', () => {
  it('round-trips only supported deep-link hashes', () => {
    expect(userProfileSectionFromHash(userProfileSectionHash('sessions'))).toBe('sessions');
    expect(userProfileSectionFromHash('#authowl-profile-unknown')).toBeNull();
    expect(userProfileSectionFromHash('#other')).toBeNull();
  });

  it('derives security sections from server capabilities and enrollment state', () => {
    expect(userProfileSectionsFor({
      password: false,
      passkeys: true,
      mfa: true,
      recovery: false,
      accountDeletion: true,
      social: true,
    })).toEqual([
      'profile',
      'email',
      'social',
      'sessions',
      'passkeys',
      'mfa',
      'danger',
    ]);
  });

  it('hides the connected-accounts section when no social provider is configured', () => {
    expect(userProfileSectionsFor({
      password: true,
      passkeys: false,
      mfa: false,
      recovery: false,
      accountDeletion: false,
      social: false,
    })).toEqual(['profile', 'email', 'password', 'sessions']);
  });

  it('formats session activity in Cairo time for both component locales', () => {
    const date = new Date('2026-07-14T12:00:00.000Z');
    expect(formatSessionTime(date, 'en')).toContain('3:00');
    expect(formatSessionTime(date, 'ar')).toContain('٣:٠٠');
  });

  it('orders sessions most recently active first', () => {
    // The exact shuffle the server returned in the wild: an afternoon session, then
    // the newest, then one a minute older, which read as an unordered list.
    const sessions = [
      { id: 'afternoon', updatedAt: new Date('2026-07-25T11:47:00.000Z') },
      { id: 'newest', updatedAt: new Date('2026-07-25T18:17:00.000Z') },
      { id: 'middle', updatedAt: new Date('2026-07-25T18:16:00.000Z') },
    ];
    expect(sortSessionsByRecency(sessions).map((row) => row.id)).toEqual([
      'newest',
      'middle',
      'afternoon',
    ]);
  });

  it('breaks ties by id and does not mutate the input', () => {
    const same = new Date('2026-07-25T18:00:00.000Z');
    const sessions = [
      { id: 'b', updatedAt: same },
      { id: 'a', updatedAt: same },
    ];
    // A total order, so equal timestamps cannot reshuffle between renders.
    expect(sortSessionsByRecency(sessions).map((row) => row.id)).toEqual(['a', 'b']);
    expect(sessions.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
