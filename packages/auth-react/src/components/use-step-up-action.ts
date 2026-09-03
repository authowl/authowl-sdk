'use client';
import * as React from 'react';
import type { AuthActionResult } from '@authowl/core';
import {
  useSubmitAction,
  type SubmitActionOptions,
  type UseSubmitActionResult,
} from './use-submit-action';

/**
 * The server code for "prove the second factor before weakening it".
 *
 * Raised by the two endpoints that can weaken an enrolled account -
 * `/two-factor/disable` and `/two-factor/generate-backup-codes` - when the
 * session has not proved a factor in the last five minutes. Knowing the
 * password is deliberately not enough: social sign-in, inbound SSO and a
 * trusted device all mint a fresh session without ever running the challenge,
 * so password-only would have voided the promise the second factor exists to
 * make.
 */
export const SECOND_FACTOR_REQUIRED = 'SECOND_FACTOR_REQUIRED';

export type UseStepUpActionResult = Pick<
  UseSubmitActionResult,
  'pending' | 'error' | 'setError'
> & {
  /** True while the server is waiting for a code before it will run the action. */
  stepUpRequired: boolean;
  /**
   * Run an action that the server may gate behind a second-factor proof. On
   * `SECOND_FACTOR_REQUIRED` the attempt is PARKED rather than surfaced as an
   * error, and `stepUpRequired` flips so the caller can render the code prompt.
   */
  run: UseSubmitActionResult['run'];
  /**
   * Replay the parked attempt. Call this once a code has been accepted; the
   * original inputs (password, options) are replayed exactly as submitted, so
   * the user never retypes anything.
   */
  resume: () => void;
  /** Abandon the parked attempt and leave step-up. */
  cancel: () => void;
};

/**
 * The park-prompt-replay envelope for a second-factor step-up.
 *
 * Both surfaces that can trip the gate need the identical three moves - catch
 * the code, collect a factor, re-run the untouched attempt - so it lives here
 * rather than twice. The gate is reactive by necessity: nothing on the client
 * can see whether this session carries a fresh assertion, so the only honest
 * design is to try, and prompt when the server says to. A user who just cleared
 * a challenge at sign-in therefore never sees the prompt at all.
 */
export function useStepUpAction(): UseStepUpActionResult {
  const { pending, error, setError, run } = useSubmitAction();
  const [stepUpRequired, setStepUpRequired] = React.useState(false);
  // The attempt itself, held verbatim. Re-running the caller's own thunk is
  // what makes the replay lossless: it closes over the inputs as submitted, so
  // resuming cannot silently send a different body than the one that was gated.
  const parked = React.useRef<(() => Promise<void>) | null>(null);

  const guardedRun = React.useCallback(
    <T,>(
      action: () => Promise<AuthActionResult<T> | null | undefined>,
      opts: SubmitActionOptions<T>,
    ): Promise<void> => {
      const attempt = (): Promise<void> => {
        parked.current = attempt;
        return run(action, {
          ...opts,
          intercept: (failure) => {
            if (failure.code !== SECOND_FACTOR_REQUIRED) return opts.intercept?.(failure) ?? false;
            setStepUpRequired(true);
            return true;
          },
        });
      };
      return attempt();
    },
    [run],
  );

  const resume = React.useCallback(() => {
    const attempt = parked.current;
    setStepUpRequired(false);
    // A resume with nothing parked is not reachable from the UI (the prompt
    // only mounts after an attempt parked one), and doing nothing is the safe
    // answer if it ever became reachable - never a blind re-send.
    void attempt?.();
  }, []);

  const cancel = React.useCallback(() => {
    parked.current = null;
    setStepUpRequired(false);
    setError(null);
  }, [setError]);

  return { pending, error, setError, stepUpRequired, run: guardedRun, resume, cancel };
}
