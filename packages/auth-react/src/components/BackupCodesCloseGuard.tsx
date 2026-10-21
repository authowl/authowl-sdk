'use client';
import * as React from 'react';

/** A containing disclosure can protect freshly displayed, one-time codes. */
export const BackupCodesCloseGuard = React.createContext<((visible: boolean) => void) | undefined>(undefined);

export function useBackupCodesCloseGuard(visible: boolean) {
  const setVisible = React.useContext(BackupCodesCloseGuard);
  React.useEffect(() => {
    setVisible?.(visible);
    return () => setVisible?.(false);
  }, [setVisible, visible]);
}
