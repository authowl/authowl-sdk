import type { Locale } from '@authowl/core';

export const USER_PROFILE_SECTIONS = [
  'profile',
  'email',
  'password',
  'social',
  'sessions',
  'passkeys',
  'mfa',
  'recovery',
  'privacy',
  'danger',
] as const;

export type UserProfileSection = (typeof USER_PROFILE_SECTIONS)[number];

export type UserProfileCapabilities = {
  password: boolean;
  passkeys: boolean;
  mfa: boolean;
  recovery: boolean;
  accountDeletion: boolean;
  /** Whether the project has any social provider configured to link/unlink. */
  social: boolean;
  /** Whether this server publishes the subject privacy contract. */
  privacy: boolean;
};

export function userProfileSectionsFor(
  capabilities: UserProfileCapabilities,
): readonly UserProfileSection[] {
  return USER_PROFILE_SECTIONS.filter((section) => {
    if (section === 'password') return capabilities.password;
    if (section === 'passkeys') return capabilities.passkeys;
    if (section === 'mfa') return capabilities.mfa;
    if (section === 'recovery') return capabilities.recovery;
    if (section === 'danger') return capabilities.accountDeletion;
    if (section === 'social') return capabilities.social;
    if (section === 'privacy') return capabilities.privacy;
    return true;
  });
}

export function userProfileSectionFromHash(hash: string): UserProfileSection | null {
  const value = hash.replace(/^#authowl-profile-/, '');
  return USER_PROFILE_SECTIONS.includes(value as UserProfileSection)
    ? (value as UserProfileSection)
    : null;
}

export function userProfileSectionHash(section: UserProfileSection): string {
  return `#authowl-profile-${section}`;
}

/**
 * Order sessions most-recently-active first.
 *
 * The server returns them in no meaningful order, so the list arrived shuffled
 * against the timestamps shown beside each row - the same date read 2:47 PM, then
 * 9:17 PM, then 9:16 PM. Sorted on `updatedAt`, which is the value the row
 * displays, so the order and the labels always agree.
 *
 * `id` breaks ties so the order is total and stable: equal timestamps would
 * otherwise let a re-render reshuffle rows under the pointer. Returns a new array
 * rather than sorting the caller's in place.
 */
export function sortSessionsByRecency<T extends { id: string; updatedAt: Date }>(
  sessions: readonly T[],
): T[] {
  return [...sessions].sort((a, b) => {
    const delta = b.updatedAt.getTime() - a.updatedAt.getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

export function formatSessionTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  }).format(date);
}
