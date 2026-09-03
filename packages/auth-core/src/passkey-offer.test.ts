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
const DAY = 24 * 60 * 60 * 1000;

describe('passkey offer memory', () => {
  beforeEach(() => localStorage.clear());

  it('is due on a browser that has never been asked', () => {
    expect(passkeyOfferIsDue(PROJECT)).toBe(true);
  });

  it('stops asking once a passkey was added from the offer', () => {
    recordPasskeyOfferSettled(PROJECT);
    expect(passkeyOfferIsDue(PROJECT)).toBe(false);
    // Still settled a year later: this is an answer, not a snooze.
    expect(passkeyOfferIsDue(PROJECT, Date.now() + 365 * DAY)).toBe(false);
  });

  it('honours a dismissal for the cool-off and then asks once more', () => {
    const now = Date.now();
    recordPasskeyOfferDismissed(PROJECT, now);

    expect(passkeyOfferIsDue(PROJECT, now)).toBe(false);
    expect(passkeyOfferIsDue(PROJECT, now + 29 * DAY)).toBe(false);
    expect(passkeyOfferIsDue(PROJECT, now + 31 * DAY)).toBe(true);
  });

  it('is scoped per project', () => {
    recordPasskeyOfferSettled(PROJECT);
    expect(passkeyOfferIsDue('env_2')).toBe(true);
  });

  it('cannot be switched off forever by a hostile or future-dated value', () => {
    localStorage.setItem(passkeyOfferStorageKey(PROJECT), 'never');
    expect(passkeyOfferIsDue(PROJECT)).toBe(true);

    // A stamp from the future would otherwise suppress the offer indefinitely
    // rather than for the cool-off.
    const now = Date.now();
    recordPasskeyOfferDismissed(PROJECT, now + 400 * DAY);
    expect(passkeyOfferIsDue(PROJECT, now)).toBe(true);
  });
});
