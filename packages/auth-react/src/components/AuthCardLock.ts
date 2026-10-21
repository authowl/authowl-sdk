'use client';
import * as React from 'react';

const useClientLayoutEffect = typeof document === 'undefined' ? React.useEffect : React.useLayoutEffect;

/** One pending lock for all entry methods on an authentication card. */
export const AuthCardLock = React.createContext<{
  locked: boolean;
  setPending: (pending: boolean) => void;
} | null>(null);

export function useAuthCardPending(pending: boolean) {
  const lock = React.useContext(AuthCardLock);
  const report = lock?.setPending;
  useClientLayoutEffect(() => {
    report?.(pending);
    return () => report?.(false);
  }, [pending, report]);
  return pending || Boolean(lock?.locked);
}
