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
 * Raised by the endpoints that can weaken an enrolled account - today
 * `/two-factor/disable` and `/two-factor/generate-backup-codes` - when the
 * session has not proved a factor in the last five minutes. Knowing the
 * password is deliberately not enough: social sign-in, inbound SSO and a
 * trusted device all mint a fresh session without ever running the challenge,
 * so password-only would have voided the promise the second factor exists to
 * make.
 *
 * Signing in again is NOT the remedy and must never be offered as one. A
 * trusted device skips the challenge, so a second sign-in mints another
 * unstamped session and the next attempt fails identically - an infinite
 * bounce. The only way through is a code.
 */
export const SECOND_FACTOR_REQUIRED = 'SECOND_FACTOR_REQUIRED';

export type UseStepUpActionResult = UseSubmitActionResult & {
  /** True while the server is waiting for a code before it will run the action. */
  stepUpRequired: boolean;
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
 * Wrap any action the server may gate behind a fresh proof, render
 * `<MFAChallenge variant="step-up" onVerified={resume} />` while
 * `stepUpRequired`, and the original request finishes on its own.
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
  // The gated attempt itself, held verbatim. Re-running the caller's own thunk
  // is what makes the replay lossless: it closes over the inputs as submitted,
  // so resuming cannot silently send a different body than the one refused.
  //
  // PARKED ONLY WHEN THE GATE ACTUALLY FIRES, and dropped the moment it is
  // replayed. That thunk captures a plaintext PASSWORD and, with it, the whole
  // enclosing render scope. Parking unconditionally would have retained the
  // password for the life of the mounted page even on submits that never hit
  // the gate, and would have quietly defeated the `setPassword('')` scrub the
  // success paths do - clearing React state does nothing to a captured string.
  // The retention window is now exactly the prompt's lifetime.
  const parked = React.useRef<(() => Promise<void>) | null>(null);
  // Bumped by `cancel`, so an attempt still in flight when the user backs out
  // cannot flip the prompt on afterwards. Without it, cancelling during the
  // request and having the gate answer a moment later drops the user into a
  // code prompt for an action they just abandoned - and `cancel` cannot simply
  // await the request, because the whole point is to stop waiting on it.
  const epoch = React.useRef(0);

  const guardedRun = React.useCallback(
    <T,>(
      action: () => Promise<AuthActionResult<T> | null | undefined>,
      opts: SubmitActionOptions<T>,
    ): Promise<void> => {
      const attempt = (): Promise<void> => {
        const era = epoch.current;
        return run(action, {
          ...opts,
          intercept: (failure) => {
            // A caller's own interceptor still runs and still wins for every
            // other code, so wrapping this hook around one does not swallow it.
            if (failure.code !== SECOND_FACTOR_REQUIRED) return opts.intercept?.(failure) ?? false;
            // Abandoned while in flight: swallow the gate without prompting.
            // Reported as handled, because the user already chose to stop - an
            // error message for a cancelled action is noise.
            if (era !== epoch.current) return true;
            // Safe self-reference: `run` awaits the action before it can call
            // `intercept`, so `attempt` is initialized by the time this runs.
            parked.current = attempt;
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
    parked.current = null;
    setStepUpRequired(false);
    // Nothing parked is not reachable from the UI - the prompt only mounts
    // after an attempt parked one - and doing nothing is the safe answer if it
    // ever became reachable. Never a blind re-send.
    void attempt?.();
  }, []);

  const cancel = React.useCallback(() => {
    epoch.current += 1;
    parked.current = null;
    setStepUpRequired(false);
    setError(null);
  }, [setError]);

  return { pending, error, setError, stepUpRequired, run: guardedRun, resume, cancel };
}
