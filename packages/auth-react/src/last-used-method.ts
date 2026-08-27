'use client';
import * as React from 'react';
import {
  readLastUsedSignInMethod,
  recordLastUsedSignInMethod,
  rememberPendingSignInMethod,
  settlePendingSignInMethod,
  type LastUsedSignInMethod,
} from '@authowl/core';
import { usePublicConfig } from './hooks';

/**
 * Which sign-in method last worked in this browser, for this project.
 *
 * Two kinds of method need different treatment, and conflating them is the bug
 * this shape exists to avoid:
 *
 *   completes in page   password, email-OTP verification, passkey - observable
 *                       success, so it is recorded when it happens.
 *
 *   leaves the page     social, SSO, magic link - the page that would observe
 *                       success is one the browser navigates away from. The
 *                       attempt is PARKED and promoted only when a session
 *                       actually appears, so bouncing off a consent screen does
 *                       not teach the form that the provider worked.
 *
 * Everything is per project and per browser, and never keyed by an identifier -
 * see the core module for why that line matters.
 */
export function useLastUsedSignInMethod(): LastUsedSignInMethod | null {
  const { config } = usePublicConfig();
  const projectId = config?.environmentId ?? null;
  // Read once per project rather than subscribing: this decides a hint, and a
  // value that changed mid-render would move a control under the pointer.
  return React.useMemo(
    () => (projectId ? readLastUsedSignInMethod(projectId) : null),
    [projectId],
  );
}

/** Recorder bound to the active project, or a no-op before config resolves. */
export function useSignInMethodRecorder(): (
  method: LastUsedSignInMethod,
  pending?: boolean,
) => void {
  const { config } = usePublicConfig();
  const projectId = config?.environmentId ?? null;
  return React.useCallback(
    (method, pending) => {
      if (!projectId) return;
      (pending ? rememberPendingSignInMethod : recordLastUsedSignInMethod)(projectId, method);
    },
    [projectId],
  );
}

/** Settle a parked redirect after the returning session finishes loading. */
export function useConfirmPendingSignInMethod(
  loaded: boolean,
  signedIn: boolean,
  projectId: string | null,
): void {
  React.useEffect(() => {
    if (loaded && projectId) settlePendingSignInMethod(projectId, signedIn);
  }, [loaded, projectId, signedIn]);
}
