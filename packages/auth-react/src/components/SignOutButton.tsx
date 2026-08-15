'use client';
import * as React from 'react';
import { useSignOut } from '../hooks';
import { useT } from '../i18n';
import { safeRedirect } from './redirect';
import { Busy } from './Spinner';

export type SignOutButtonProps = {
  /** Button label (defaults to "Sign out"). */
  children?: React.ReactNode;
  /** Where to navigate after sign-out (same-origin/relative only). */
  redirectTo?: string;
  /** Called after the session is cleared. */
  onSignedOut?: () => void;
  className?: string;
};

/**
 * Standalone sign-out button. Clears the session, then notifies and redirects
 * (same-origin/relative targets only). For a menu with avatar + sign-out, use
 * <UserButton/> instead.
 */
export function SignOutButton({ children, redirectTo, onSignedOut, className }: SignOutButtonProps) {
  const t = useT();
  const { signOut } = useSignOut();
  const [pending, setPending] = React.useState(false);
  // No busy label of its own: show a spinner beside the same label when busy.
  const content = children ?? t('signOut.button');

  return (
    <button
      type="button"
      className={className ?? 'ba-button'}
      disabled={pending}
      aria-busy={pending || undefined}
      data-testid="signout-button"
      onClick={async () => {
        setPending(true);
        try {
          await signOut();
          onSignedOut?.();
          safeRedirect(redirectTo);
        } finally {
          setPending(false);
        }
      }}
    >
      <Busy busy={pending} label={content}>{content}</Busy>
    </button>
  );
}
