'use client';
import * as React from 'react';
import { useAuthClient } from '../hooks';
import { finishSignIn } from './finish-sign-in';

const completedHandoffs = new WeakSet<Promise<boolean>>();

/** Complete only this page's redeemed callback, after its app session exists. */
export function useHandoffCompletion(redirectTo?: string, onSignedIn?: () => void): void {
  const { handoff, sessionStore } = useAuthClient();
  const latest = React.useRef({ sessionStore, redirectTo, onSignedIn });
  latest.current = { sessionStore, redirectTo, onSignedIn };
  React.useEffect(() => {
    void handoff?.then((redeemed) => {
      if (!redeemed || completedHandoffs.has(handoff)) return;
      completedHandoffs.add(handoff);
      return finishSignIn(latest.current);
    }).catch(() => undefined);
  }, [handoff]);
}
