'use client';
import * as React from 'react';
import {
  confirmPendingSignInMethod,
  readLastUsedSignInMethod,
  recordLastUsedSignInMethod,
  rememberPendingSignInMethod,
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

/** Recorders bound to the active project, or no-ops before config resolves. */
export function useSignInMethodRecorder(): {
  recordSucceeded: (method: LastUsedSignInMethod) => void;
  rememberLeaving: (method: LastUsedSignInMethod) => void;
} {
  const { config } = usePublicConfig();
  const projectId = config?.environmentId ?? null;
  return React.useMemo(
    () => ({
      recordSucceeded: (method) => {
        if (projectId) recordLastUsedSignInMethod(projectId, method);
      },
      rememberLeaving: (method) => {
        if (projectId) rememberPendingSignInMethod(projectId, method);
      },
    }),
    [projectId],
  );
}

/**
 * Promote a parked redirect attempt once a session exists.
 *
 * Mounted once, centrally, rather than in each component that can start a
 * redirect - the page that comes back is frequently not the one that left.
 */
export function useConfirmPendingSignInMethod(signedIn: boolean, projectId: string | null): void {
  React.useEffect(() => {
    if (!signedIn || !projectId) return;
    confirmPendingSignInMethod(projectId);
  }, [projectId, signedIn]);
}
