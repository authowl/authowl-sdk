'use client';
import * as React from 'react';
import { useAuthClient } from '../hooks';
import { finishSignIn } from './finish-sign-in';

const completedHandoffs = new WeakSet<Promise<boolean>>();

/** Complete only this page's redeemed callback, after its app session exists. */
export function useHandoffCompletion(redirectTo?: string, onSignedIn?: () => void): void {
  const { handoff, sessionStore } = useAuthClient();
  React.useEffect(() => {
    let active = true;
    void handoff?.then((redeemed) => {
      if (!active || !redeemed || completedHandoffs.has(handoff)) return;
      completedHandoffs.add(handoff);
      return finishSignIn({ sessionStore, redirectTo, onSignedIn });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [handoff, sessionStore, redirectTo, onSignedIn]);
}
