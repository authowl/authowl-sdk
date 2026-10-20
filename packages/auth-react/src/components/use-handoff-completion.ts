'use client';
import * as React from 'react';
import { useAuthClient } from '../hooks';
import { finishSignIn } from './finish-sign-in';

const completedHandoffs = new WeakSet<Promise<boolean>>();
const completingHandoffs = new WeakSet<Promise<boolean>>();

/** Complete only this page's redeemed callback, after its app session exists. */
export function useHandoffCompletion(
  redirectTo?: string,
  onSignedIn?: () => void,
  onError?: () => void,
): void {
  const { handoff, sessionStore } = useAuthClient();
  const latest = React.useRef({ sessionStore, redirectTo, onSignedIn, onError });
  latest.current = { sessionStore, redirectTo, onSignedIn, onError };
  React.useEffect(() => {
    // Deliberately no cleanup: <SignedOut> unmounts the form as soon as sign-in
    // succeeds, but completion must survive that unmount to navigate afterwards.
    void handoff?.then(async (redeemed) => {
      if (!redeemed) {
        latest.current.onError?.();
        return;
      }
      if (completedHandoffs.has(handoff) || completingHandoffs.has(handoff)) return;
      completingHandoffs.add(handoff);
      try {
        await finishSignIn({
          ...latest.current,
          waitForMfaEnrollment: true,
          onCompleted: () => completedHandoffs.add(handoff),
        });
      } finally {
        completingHandoffs.delete(handoff);
      }
    }).catch(() => latest.current.onError?.());
  }, [handoff]);
}
