'use client';
import * as React from 'react';
import { usePublicConfig } from '../hooks';
import { useT, richMessage } from '../i18n';

export type AuthOwlBadgeProps = {
  /** Override the link target (defaults to the AuthOwl site). */
  href?: string;
  /**
   * Render the badge even when the plan would hide it (paid/comped projects).
   * Free projects always show it. Use this to keep the "Secured by AuthOwl"
   * attribution visible on a paid project by choice.
   */
  force?: boolean;
};

/** Small owl mark in AuthOwl gold - reads on both light and dark grounds. */
function OwlMark() {
  return (
    <svg className="ba-badge-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill="#F5B84C" />
      <circle cx="8.4" cy="10" r="3" fill="#fff" />
      <circle cx="15.6" cy="10" r="3" fill="#fff" />
      <circle cx="8.4" cy="10" r="1.4" fill="#1f1300" />
      <circle cx="15.6" cy="10" r="1.4" fill="#1f1300" />
      <path d="M12 13.1l1.5 2.1h-3z" fill="#1f1300" />
    </svg>
  );
}

/**
 * "Secured by AuthOwl" attribution. Shown on free-plan projects and hidden on
 * paid plans - the server sets `config.badge` from the workspace's entitled plan,
 * so this renders when `badge` is true (or when `force` is set). Auto-rendered at
 * the foot of <SignIn/> and <SignUp/>; also exported so headless consumers can
 * place it themselves.
 *
 * It is a plain client element: a consumer can hide it with CSS. Removing it on
 * the free plan is a terms-of-service matter, not a technical control - the same
 * posture every embeddable auth widget takes.
 */
export function AuthOwlBadge({ href = 'https://authowl.dev', force }: AuthOwlBadgeProps = {}) {
  const t = useT();
  const { config } = usePublicConfig();
  if (!force && !config?.badge) return null;
  return (
    <a
      className="ba-badge"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="authowl-badge"
    >
      <OwlMark />
      <span>
        {richMessage(t('badge.securedBy'), {
          brand: <span className="ba-badge-brand">AuthOwl</span>,
        })}
      </span>
    </a>
  );
}
