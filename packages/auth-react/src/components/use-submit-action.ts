'use client';
import * as React from 'react';
import type { AuthActionResult, AuthClientError } from '@authowl/core';
import { useServerError } from '../i18n';

/** Everything `run` needs besides the action itself. */
export type SubmitActionOptions<T> = {
  /** Generic, already-localized copy shown when the action fails. */
  failure: string;
  onSuccess?: (res: AuthActionResult<T>) => void | Promise<void>;
  /**
   * Override the default code-based error message for an endpoint-specific
   * status (e.g. SSO's bare 404 = "no connection for this domain", which is
   * not a global server code). Return a message to use, or null to fall back
   * to the standard `useServerError` mapping.
   */
  mapError?: (error: AuthClientError) => string | null;
  /**
   * Take over a failure entirely instead of rendering it. Return true when the
   * caller has handled the error by swapping the UI (the second-factor step-up
   * prompt is the case this exists for), and no message is surfaced. Runs
   * before `mapError`, which only ever produces text.
   */
  intercept?: (error: AuthClientError) => boolean;
  /**
   * Keep `pending` true after a SUCCESSFUL action instead of resetting it -
   * for redirect-out actions (SSO) where the browser navigates away, so the
   * spinner persists through the navigation instead of flashing back to idle.
   * Error and throw paths still reset. Only safe when success always navigates
   * away; a success that stays on the page would leave a stuck spinner (which
   * is why magic-link/OTP, whose success swaps a view in place, do NOT set it).
   */
  keepPendingOnSuccess?: boolean;
};

export type UseSubmitActionResult = {
  /** True while an action is in flight (drives disabled buttons / busy labels). */
  pending: boolean;
  /** The last surfaced error message, or null. */
  error: string | null;
  /** Set/clear the error directly (e.g. an initial load outside `run`). */
  setError: (message: string | null) => void;
  /**
   * Run a client action and own the loading/error skeleton: clear the error, set
   * pending, await the action, surface `res.error` (or the thrown message) as
   * `failure`, and invoke `onSuccess` only on a clean result. Every sign-in
   * surface differs only in its action and success branch, so this keeps that
   * envelope in one place. Generic in the action's data type, so `onSuccess`
   * receives a fully-typed `res` without a cast.
   */
  run: <T>(
    action: () => Promise<AuthActionResult<T> | null | undefined>,
    opts: SubmitActionOptions<T>,
  ) => Promise<void>;
};

export function useSubmitAction(): UseSubmitActionResult {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toMessage = useServerError();

  const run = React.useCallback<UseSubmitActionResult['run']>(
    async (action, { failure, onSuccess, mapError, intercept, keepPendingOnSuccess }) => {
      setError(null);
      setPending(true);
      try {
        const res = await action();
        if (res?.error) {
          // `setError(null)` above already cleared the previous message, so an
          // intercepted failure leaves no stale text behind the new UI.
          if (!intercept?.(res.error)) {
            setError(mapError?.(res.error) ?? toMessage(res.error, failure));
          }
          setPending(false);
          return;
        }
        await onSuccess?.(res ?? { data: null, error: null });
        // On a redirect-out success (SSO), keep the spinner up through the
        // navigation instead of flashing back to idle; everything else resets.
        if (!keepPendingOnSuccess) setPending(false);
      } catch {
        // Thrown errors (network, SDK internals) carry English messages -
        // surface the localized generic instead. Always re-enable so the user
        // can retry (keepPendingOnSuccess never suppresses a failure reset).
        setError(failure);
        setPending(false);
      }
    },
    [toMessage],
  );

  return { pending, error, setError, run };
}
