/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  passkeyOfferIsDue,
  passkeyOfferStorageKey,
  recordPasskeyOfferDismissed,
  recordPasskeyOfferSettled,
} from './passkey-offer';

const PROJECT = 'env_1';
const USER = 'user-1';
const DAY = 24 * 60 * 60 * 1000;

describe('passkey offer memory', () => {
  beforeEach(() => localStorage.clear());

  it('is due on a browser that has never been asked', () => {
    expect(passkeyOfferIsDue(PROJECT, USER)).toBe(true);
  });

  it('stops asking once a passkey was added from the offer', () => {
    recordPasskeyOfferSettled(PROJECT, USER);
    expect(passkeyOfferIsDue(PROJECT, USER)).toBe(false);
    // Still settled a year later: this is an answer, not a snooze.
    expect(passkeyOfferIsDue(PROJECT, USER, Date.now() + 365 * DAY)).toBe(false);
  });

  it('honours a dismissal for the cool-off and then asks once more', () => {
    const now = Date.now();
    recordPasskeyOfferDismissed(PROJECT, USER, now);

    expect(passkeyOfferIsDue(PROJECT, USER, now)).toBe(false);
    expect(passkeyOfferIsDue(PROJECT, USER, now + 29 * DAY)).toBe(false);
    expect(passkeyOfferIsDue(PROJECT, USER, now + 31 * DAY)).toBe(true);
  });

  it('is scoped per project', () => {
    recordPasskeyOfferSettled(PROJECT, USER);
    expect(passkeyOfferIsDue('env_2', USER)).toBe(true);
  });

  it('is scoped per user, so one account cannot answer for another', () => {
    // A shared or family device is ordinary for a consumer auth SDK. Keyed per
    // project alone, the first person to enrol silenced the offer for everyone
    // after them - and permanently, because the due-check short-circuits before
    // the server is ever asked.
    recordPasskeyOfferSettled(PROJECT, USER);
    expect(passkeyOfferIsDue(PROJECT, 'user-2')).toBe(true);

    recordPasskeyOfferDismissed(PROJECT, 'user-2');
    expect(passkeyOfferIsDue(PROJECT, 'user-3')).toBe(true);
  });

  it('cannot be switched off forever by a hostile or future-dated value', () => {
    localStorage.setItem(passkeyOfferStorageKey(PROJECT, USER), 'never');
    expect(passkeyOfferIsDue(PROJECT, USER)).toBe(true);

    // A stamp from the future would otherwise suppress the offer indefinitely
    // rather than for the cool-off.
    const now = Date.now();
    recordPasskeyOfferDismissed(PROJECT, USER, now + 400 * DAY);
    expect(passkeyOfferIsDue(PROJECT, USER, now)).toBe(true);
  });
});
