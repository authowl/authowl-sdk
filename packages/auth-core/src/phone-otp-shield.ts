import type * as AkedlyShield from '@akedly/shield';

import type { AkedlyShieldStartProof, PhoneOtpChallengeData } from './client';

/**
 * Complete Akedly Shield's browser-only proof ceremony. The provider package is
 * lazy-loaded only when the server-selected route requires it.
 */
export async function solvePhoneOtpChallenge(
  challenge: Extract<PhoneOtpChallengeData, { kind: 'akedly_shield_v1_2' }>,
): Promise<AkedlyShieldStartProof> {
  if (typeof window === 'undefined') {
    throw new Error('Akedly Shield challenges must be solved in a browser.');
  }
  const shield = await loadShield();
  const pow = challenge.challengeRequired
    ? await shield.solvePow(challenge.challenge, challenge.difficulty)
    : null;
  const turnstileToken = challenge.turnstile.required
    ? await shield.getTurnstileToken(requireSiteKey(challenge.turnstile.siteKey))
    : undefined;
  return {
    connectionId: challenge.connectionId,
    ...(pow ? { challengeToken: challenge.challengeToken, nonce: pow.nonce } : {}),
    ...(turnstileToken ? { turnstileToken } : {}),
  };
}

/**
 * Load the provider package only when the server selects a Shield route. It is
 * a direct dependency so consumer bundlers can always resolve the import, while
 * the dynamic boundary keeps its browser code out of the initial chunk.
 */
async function loadShield(): Promise<typeof AkedlyShield> {
  return import('@akedly/shield');
}

function requireSiteKey(value: string | null): string {
  if (!value) throw new Error('Akedly Shield did not provide a Turnstile site key.');
  return value;
}
