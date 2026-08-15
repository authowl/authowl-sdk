import type { CSSProperties } from 'react';

/**
 * Surface card used to frame the drop-in conversion forms in Storybook, mirroring
 * how the account/organization stories present their components (and how a
 * consumer embeds them). It is also the ground the SDK's accent and body colors
 * are tuned against, so text meets contrast in the a11y matrix.
 */
export const card: CSSProperties = {
  maxWidth: 420,
  margin: '0 auto',
  padding: 24,
  background: 'var(--ba-surface)',
  color: 'var(--ba-fg)',
  border: '1px solid var(--ba-border)',
  borderRadius: 14,
};
