'use client';
import * as React from 'react';

export type FormErrorProps = {
  /**
   * The resolved, already-localized error message (from `useSubmitAction`'s
   * `error` / `resolveServerError`, or a component's own generic copy). Renders
   * nothing when empty, so call sites can drop the `{error && …}` guard.
   */
  children?: React.ReactNode;
  /** Extra class names appended after `ba-error` (rare; keeps the default look). */
  className?: string;
  /** Passed through for tests/hooks that target a specific error node. */
  'data-testid'?: string;
};

/**
 * The one place a form/action error is rendered, so EVERY surface announces it
 * to assistive tech. `role="alert"` + `aria-live="assertive"` make a screen
 * reader speak the message the instant it appears — previously ~half the
 * surfaces rendered a silent `<p className="ba-error">`, so a wrong TOTP/OTP/
 * passkey/reset/verify error was never announced.
 *
 * Visually identical to the former inline paragraph: same `ba-error` class, same
 * placement. The message text is passed through VERBATIM — all resolution (the
 * readable-error + retry-backoff policy) still happens upstream in
 * `resolveServerError`; this only owns the announced-wrapper semantics.
 */
export function FormError({ children, className, 'data-testid': testId }: FormErrorProps) {
  if (children == null || children === '' || children === false) return null;
  return (
    <p
      className={className ? `ba-error ${className}` : 'ba-error'}
      role="alert"
      aria-live="assertive"
      data-testid={testId}
    >
      {children}
    </p>
  );
}
