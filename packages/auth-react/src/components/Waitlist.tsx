'use client';
import { useStepFocus } from './use-step-focus';
import { AuthField } from './AuthField';
import { useSlot } from '../elements';
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
  const slot = useSlot();
  const t = useT();
  const { join } = useWaitlist();
  const { pending, error, run } = useSubmitAction();
  const authChallenge = useAuthChallenge();
  const [email, setEmail] = React.useState('');
  const [joined, setJoined] = React.useState(false);

  const step = joined ? 'accepted' : 'form';
  const { stepRef } = useStepFocus(step, true);

  return (
    <div key={step} ref={stepRef} className={slot('ba-form ba-step')} data-testid={`waitlist-${step}`} role={joined ? 'status' : undefined}>
      {showBranding ? <AuthOwlBranding /> : null}
      <h2 className={slot('ba-title')}>{t(joined ? 'waitlist.acceptedTitle' : 'waitlist.title')}</h2>
      <p className={slot('ba-muted')}>{t(joined ? 'waitlist.acceptedDescription' : 'waitlist.description')}</p>
      {!joined && (
      <form
        method="post"
        className={slot('ba-fields')}
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
        <AuthField
          label={t('common.emailLabel')}
          type="email"
          value={email}
          maxLength={320}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
        {authChallenge.control}
        <FormError>{error}</FormError>
        <button
          className={slot('ba-button')}
          type="submit"
          disabled={pending || authChallenge.configPending}
          aria-busy={pending || undefined}
        >
          <Busy busy={pending} label={t('waitlist.submitPending')}>
            {t('waitlist.submit')}
          </Busy>
        </button>
      </form>
      )}
      <AuthOwlBadge force={showBadge} />
    </div>
  );
}
