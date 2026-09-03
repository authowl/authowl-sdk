'use client';
import * as React from 'react';
import { usePasskeys } from '../hooks';
import { useT, type MessageKey } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type PasskeyOfferProps = {
  /**
   * Continue. `added` says which outcome it was, so a caller can remember a
   * decline differently from an enrolment - a decline is worth asking about
   * again eventually; an enrolment never is.
   */
  onComplete: (added: boolean) => void;
  /**
   * Which moment this is, which decides the copy only:
   *
   *  - `sign-up`  the last step of registration, turning a fresh account into a
   *               passkey account.
   *  - `sign-in`  offered once to a returning user who signed in another way, so
   *               the next visit needs no password.
   */
  variant?: 'sign-up' | 'sign-in';
};

/** One place the two moments' copy is chosen, so neither borrows the other's. */
const COPY: Record<
  'sign-up' | 'sign-in',
  { testId: string } & Record<'title' | 'body' | 'submit' | 'skip' | 'failed', MessageKey>
> = {
  'sign-up': {
    // Unchanged from when this was PasskeySignUpCompletion: the id is part of
    // what callers and tests already target.
    testId: 'signup-passkey-completion',
    title: 'signUp.passkeyTitle',
    body: 'signUp.passkeyDescription',
    submit: 'signUp.passkeySubmit',
    skip: 'signUp.passkeySkip',
    failed: 'signUp.error.passkeyFailed',
  },
  'sign-in': {
    testId: 'signin-passkey-offer',
    title: 'passkeyOffer.title',
    body: 'passkeyOffer.description',
    submit: 'passkeyOffer.submit',
    skip: 'passkeyOffer.skip',
    failed: 'passkeyOffer.error',
  },
};

/**
 * The "add a passkey to this device" step.
 *
 * DECLINING IS A FIRST-CLASS OUTCOME, not an escape hatch: skip calls the same
 * `onComplete` as success, so the flow it interrupts always continues. The same
 * is true of a failed ceremony - the error is shown, and the user can still move
 * on. Nothing here may strand someone who is already signed in.
 */
export function PasskeyOffer({ onComplete, variant = 'sign-up' }: PasskeyOfferProps) {
  const t = useT();
  const { addPasskey } = usePasskeys();
  const { pending, error, run } = useSubmitAction();
  const copy = COPY[variant];

  return (
    <div className="ba-fields" data-testid={copy.testId}>
      <h3 className="ba-title">{t(copy.title)}</h3>
      <p className="ba-muted">{t(copy.body)}</p>
      <FormError>{error}</FormError>
      <button
        className="ba-button"
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() => void run(() => addPasskey(), {
          failure: t(copy.failed),
          onSuccess: () => onComplete(true),
        })}
      >
        <Busy busy={pending} label={t('passkey.waiting')}>{t(copy.submit)}</Busy>
      </button>
      <button className="ba-link-button" type="button" disabled={pending} onClick={() => onComplete(false)}>
        {t(copy.skip)}
      </button>
    </div>
  );
}
