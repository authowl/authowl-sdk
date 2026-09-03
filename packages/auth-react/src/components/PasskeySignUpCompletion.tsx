'use client';
import * as React from 'react';
import { PasskeyOffer } from './PasskeyOffer';

export type PasskeySignUpCompletionProps = {
  onComplete: () => void;
};

/**
 * Optional final signup step that turns the freshly proved account into a
 * passkey account. Kept as its own export because it is public API; the step
 * itself is {@link PasskeyOffer}, which also serves the post-sign-in offer.
 */
export function PasskeySignUpCompletion({ onComplete }: PasskeySignUpCompletionProps) {
  return <PasskeyOffer variant="sign-up" onComplete={() => onComplete()} />;
}
