'use client';
import * as React from 'react';

/**
 * Decorative loading spinner (`.ba-spinner`). It carries no text, so pair it
 * with a visible label (as `<Busy>` does on action buttons) or an sr-only label
 * (as `<AuthLoading>` does): on its own it is `aria-hidden` and invisible to
 * assistive tech. RTL-safe and reduced-motion-aware via CSS in `styles.css`.
 */
export function Spinner() {
  return <span className="ba-spinner" aria-hidden="true" />;
}

export type BusyProps = {
  /** True while the owning action is in flight. */
  busy: boolean;
  /**
   * Content shown next to the spinner while busy (e.g. "Signing in…"). Usually a
   * localized string; typed as a node so buttons with no busy label (SignOutButton)
   * can reuse their idle content.
   */
  label: React.ReactNode;
  /** The idle content shown when not busy. */
  children: React.ReactNode;
};

/**
 * Standard busy-button content: a spinner + the busy label while `busy`, else the
 * idle `children`. Keeping the visible text (rather than swapping to a bare
 * spinner) means the existing localized busy labels carry over with zero new
 * strings, and the button keeps a sane width. Pair with `aria-busy` on the
 * `<button>` element itself (which stays per-site). Internal to the package.
 */
export function Busy({ busy, label, children }: BusyProps) {
  return busy ? (
    <>
      <Spinner />
      {label}
    </>
  ) : (
    <>{children}</>
  );
}
