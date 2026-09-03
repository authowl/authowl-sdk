'use client';
import * as React from 'react';
import {
  passkeyOfferIsDue,
  recordPasskeyOfferDismissed,
  recordPasskeyOfferSettled,
} from '@authowl/core';
import { usePasskeys, usePublicConfig, useUser } from '../hooks';
import { resolveProjectCapabilities } from '../project-capabilities';
import { passkeyReachableForConfig } from '../signin-methods';

/**
 * Should this signed-in user be offered a passkey on this device, right now?
 *
 * Advertising passkeys at sign-in is backwards: a first-time visitor cannot use
 * one, and the browser deliberately will not tell us whether a credential
 * exists (it would be a fingerprinting oracle). The moment that works is just
 * AFTER a successful sign-in by another method, when the account is known and
 * the session can register a credential.
 *
 * EVERY GATE HERE EXISTS TO AVOID OFFERING A DEAD END:
 *
 * - `passkeyAdd` - the project may not allow registration at all.
 * - `passkeyReachableForConfig` - the relying party is the id the server
 *   reports, defaulting to the AUTH host when it reports none. A ceremony
 *   started on a page that is neither that host nor a registrable suffix of it
 *   is refused by the browser before any network call, so off-host the offer is
 *   not unlikely to work, it is impossible.
 * - `PublicKeyCredential` - no WebAuthn, no ceremony.
 * - NOT `twoFactorEnabled` - a 2FA-enrolled user cannot complete a passkey
 *   sign-in today (the assurance gate runs with `userVerified: false`), so the
 *   credential we minted could never be used. Offering it would ship a fresh
 *   dead end from the change that removes one.
 * - no passkey already registered - asked of the SERVER, because a credential
 *   synced from another device or added on the account page is invisible to
 *   this browser's own memory.
 * - not already answered here - see `passkeyOfferIsDue`.
 *
 * The server check is the only one that costs a request, so it runs last and
 * only for a user who has passed everything else.
 */
export function usePasskeyOffer(): {
  /**
   * Who to ask, or null when nobody should be asked yet - config still
   * loading, signed out, or any gate below failing. Callers key their check on
   * it, so the whole eligibility predicate stays in ONE place instead of being
   * split between this hook and whatever renders the offer.
   */
  subject: string | null;
  /** Resolves true only on CONFIRMED evidence that the offer should be shown. */
  shouldOffer: () => Promise<boolean>;
  /** Remember which way the user answered, so they are not asked again. */
  remember: (added: boolean) => void;
} {
  const { config } = usePublicConfig();
  const { user, isSignedIn } = useUser();
  const { listPasskeys } = usePasskeys();
  // The passkey API is proxy-fabricated and hands back a fresh reference every
  // render, so it is read through a ref - keying a callback on it would rebuild
  // the callback endlessly. Same reason PasskeyManager does it.
  const api = React.useRef(listPasskeys);
  api.current = listPasskeys;

  const projectId = config?.environmentId ?? null;
  const eligible =
    projectId !== null
    && isSignedIn
    && resolveProjectCapabilities(config).passkeyAdd
    && user?.twoFactorEnabled !== true
    && typeof window !== 'undefined'
    && 'PublicKeyCredential' in window
    && passkeyReachableForConfig(config, window.location.hostname);

  const shouldOffer = React.useCallback(async (): Promise<boolean> => {
    if (!eligible || projectId === null || !passkeyOfferIsDue(projectId)) return false;
    try {
      const res = await api.current();
      // Only a CONFIRMED empty list opens the offer. An error means we do not
      // know, and interrupting a working sign-in to ask a question we cannot
      // justify is worse than staying quiet.
      if (res?.error || !res?.data) return false;
      return res.data.length === 0;
    } catch {
      return false;
    }
  }, [eligible, projectId]);

  const remember = React.useCallback(
    (added: boolean) => {
      if (projectId === null) return;
      if (added) recordPasskeyOfferSettled(projectId);
      else recordPasskeyOfferDismissed(projectId);
    },
    [projectId],
  );

  // Null unless EVERY gate passes, so a caller cannot accidentally ask on a
  // partially-satisfied predicate.
  return { subject: eligible ? user?.id ?? null : null, shouldOffer, remember };
}
