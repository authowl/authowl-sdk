'use client';
import * as React from 'react';
import { useWaitlist } from '../hooks';
import { useT } from '../i18n';
import { AuthOwlBadge } from './AuthOwlBadge';
import { AUTH_CHALLENGE_ACTIONS, useAuthChallenge } from './AuthChallenge';
import { FormError } from './FormError';
import { Busy } from './Spinner';
import { useSubmitAction } from './use-submit-action';
import { AuthOwlBranding } from './AuthOwlBranding';

export type WaitlistProps = {
  onJoined?: () => void;
  /**
   * Force the "Secured by AuthOwl" badge on even when the plan would hide it.
   * Free projects always show it regardless.
   */
  showBadge?: boolean;
  /** Hide the project header when the host surface renders the same branding itself. */
  showBranding?: boolean;
};

export function Waitlist({ onJoined, showBadge, showBranding = true }: WaitlistProps = {}) {
  const t = useT();
  const { join } = useWaitlist();
  const { pending, error, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [joined, setJoined] = React.useState(false);

  if (joined) {
    return (
      <div className="ba-form" data-testid="waitlist-accepted">
        {showBranding ? <AuthOwlBranding /> : null}
        <h2 className="ba-title">{t('waitlist.acceptedTitle')}</h2>
        <p className="ba-muted">{t('waitlist.acceptedDescription')}</p>
        <AuthOwlBadge force={showBadge} />
      </div>
    );
  }

  return (
    <div className="ba-form" data-testid="waitlist-form">
      {showBranding ? <AuthOwlBranding /> : null}
      <h2 className="ba-title">{t('waitlist.title')}</h2>
      <p className="ba-muted">{t('waitlist.description')}</p>
      <form
        method="post"
        className="ba-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => authChallenge.run(
              AUTH_CHALLENGE_ACTIONS.waitlist,
              (options) => join({ email }, options),
            ),
            {
              failure: t('waitlist.error.failed'),
              onSuccess: () => {
                setJoined(true);
                onJoined?.();
              },
            },
          );
        }}
      >
        <label className="ba-label">
          {t('common.emailLabel')}
          <input
            className="ba-input"
            type="email"
            value={email}
            maxLength={320}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {authChallenge.control}
        <FormError>{error}</FormError>
        <button
          className="ba-button"
          type="submit"
          disabled={pending || authChallenge.configPending}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('waitlist.submitPending')}>
            {t('waitlist.submit')}
          </Busy>
        </button>
      </form>
      <AuthOwlBadge force={showBadge} />
    </div>
  );
}
