'use client';
import * as React from 'react';
import {
  passkeyOfferIsDue,
  recordPasskeyOfferDismissed,
  recordPasskeyOfferSettled,
} from '@authowl/core';
import { usePasskeys, usePublicConfig, useSession, useUser } from '../hooks';
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
 * A 2FA-ENROLLED USER IS OFFERED ONE, and an earlier version of this hook
 * refused them. That refusal cited a comment saying such a user "cannot
 * complete a passkey sign-in at all today"; the server says otherwise.
 * `passkeyAssuranceGate` allows any assertion that performed USER VERIFICATION
 * - a passkey with a biometric or PIN is possession plus inherence, which is
 * two factors, so it both passes the sign-in and satisfies MFA. Only a
 * UV-ABSENT assertion is refused for an enrolled user.
 *
 * The cost of that mistake was the whole feature: on a project with MFA
 * required, every user is enrolled, so the offer could never fire for anyone -
 * exactly the population a passkey helps most, since it replaces the password
 * AND the code.
 * - no passkey already registered - asked of the SERVER, because a credential
 *   synced from another device or added on the account page is invisible to
 *   this browser's own memory.
 * - not already answered BY THIS USER here - see `passkeyOfferIsDue`.
 *
 * The server check is the only one that costs a request, so it runs last and
 * only for a user who has passed everything else.
 */
export function usePasskeyOffer(): {
  /**
   * Who to ask and the exact session that qualified, or null when nobody should
   * be asked yet. The session key prevents an old decision being reused across
   * sign-out or a rapid A -> B -> A account switch. Callers key their check on
   * this value, so the whole eligibility predicate stays in one place.
   */
  subject: Readonly<{ userId: string; sessionKey: string }> | null;
  /** Resolves true only on CONFIRMED evidence that the offer should be shown. */
  shouldOffer: () => Promise<boolean>;
  /** Remember which way the user answered, so they are not asked again. */
  remember: (added: boolean) => void;
  /**
   * Options the offer's registration ceremony should use for THIS user.
   *
   * `platform` for a 2FA-enrolled user: their credential only clears the
   * sign-in gate if the ceremony performs user verification, and a platform
   * authenticator (Touch ID, Face ID, Windows Hello) does that by default. UV
   * cannot be requested directly - the registration surface exposes no
   * `userVerification` option, and WebAuthn reports UV per assertion rather
   * than per device, so it is not knowable in advance either. Steering the
   * authenticator is the honest lever available.
   *
   * A user with no second factor is unconstrained: any authenticator works for
   * them, so narrowing the choice would cost them a roaming key for nothing.
   */
  registration: Readonly<{ authenticatorAttachment?: 'platform' }>;
} {
  const { config } = usePublicConfig();
  const { user, isSignedIn } = useUser();
  const { data: sessionData } = useSession();
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
    && typeof window !== 'undefined'
    && 'PublicKeyCredential' in window
    && passkeyReachableForConfig(config, window.location.hostname);

  // Null unless EVERY gate passes, so a caller cannot ask on a partially
  // satisfied predicate - and so ONE value answers "should anyone be asked".
  const userId = user?.id ?? null;
  const sessionId = sessionData?.session?.id ?? null;
  const subject = React.useMemo(
    () => eligible && userId && sessionId
      ? { userId, sessionKey: `${projectId}:${sessionId}:${userId}` }
      : null,
    [eligible, projectId, sessionId, userId],
  );

  const shouldOffer = React.useCallback(async (): Promise<boolean> => {
    if (
      subject === null
      || projectId === null
      || !passkeyOfferIsDue(projectId, subject.userId)
    ) {
      return false;
    }
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
  }, [subject, projectId]);

  const remember = React.useCallback(
    (added: boolean) => {
      if (projectId === null || subject === null) return;
      if (added) recordPasskeyOfferSettled(projectId, subject.userId);
      else recordPasskeyOfferDismissed(projectId, subject.userId);
    },
    [projectId, subject],
  );

  const registration = React.useMemo(
    () => (user?.twoFactorEnabled === true ? { authenticatorAttachment: 'platform' as const } : {}),
    [user?.twoFactorEnabled],
  );

  return { subject, shouldOffer, remember, registration };
}
