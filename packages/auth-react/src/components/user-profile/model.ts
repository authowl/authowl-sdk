import type { Locale } from '@authowl/core';
import type { MessageKey } from '../../i18n';

export type NonEmpty<T> = readonly [T, ...T[]];

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

/** Navigation order and section order within each account page. */
export const USER_PROFILE_GROUPS = [
  { id: 'profile', title: 'userProfile.nav.profile', subtitle: 'userProfile.group.profile.description', sections: ['profile', 'email'] },
  { id: 'security', title: 'userProfile.group.security', subtitle: 'userProfile.group.security.description', sections: ['password', 'passkeys', 'mfa', 'recovery', 'sessions'] },
  { id: 'connections', title: 'userProfile.nav.social', subtitle: 'userProfile.group.connections.description', sections: ['social'] },
  { id: 'privacy', title: 'userProfile.nav.privacy', subtitle: 'userProfile.group.privacy.description', sections: ['privacy', 'danger'] },
] as const satisfies readonly { id: string; title: MessageKey; subtitle: MessageKey; sections: NonEmpty<UserProfileSection> }[];

export type UserProfileGroup = (typeof USER_PROFILE_GROUPS)[number]['id'];

export function userProfileGroupsFor(sections: readonly UserProfileSection[]) {
  return USER_PROFILE_GROUPS.flatMap((group) => {
    const [first, ...rest] = group.sections.filter((section) => sections.includes(section));
    return first ? [{ ...group, sections: [first, ...rest] as NonEmpty<UserProfileSection> }] : [];
  });
}

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

/**
 * Session activity in the end user's own zone. Sessions load after mount, so
 * this only runs in the browser, where the default zone is the visitor's.
 * `timeZone` exists for deterministic tests.
 */
export function formatSessionTime(date: Date, locale: Locale, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}
