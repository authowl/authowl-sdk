'use client';
import * as React from 'react';

const useClientLayoutEffect = typeof document === 'undefined' ? React.useEffect : React.useLayoutEffect;

/** One pending lock for all entry methods on an authentication card. */
export const AuthCardLock = React.createContext<{
  locked: boolean;
  setPending: (pending: boolean) => void;
} | null>(null);

export function useAuthCardLock(pending: boolean) {
  const [count, setCount] = React.useState(0);
  const setPending = React.useCallback((started: boolean) => {
    setCount((value) => value + (started ? 1 : -1));
  }, []);
  return { locked: pending || count > 0, setPending };
}

export function useAuthCardPending(pending: boolean) {
  const lock = React.useContext(AuthCardLock);
  const report = lock?.setPending;
  useClientLayoutEffect(() => {
    if (!pending) return;
    report?.(true);
    return () => report?.(false);
  }, [pending, report]);
  return pending || Boolean(lock?.locked);
}
