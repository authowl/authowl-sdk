'use client';
import * as React from 'react';
import { usePasskeys } from '../hooks';
import { useT } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type PasskeySignUpCompletionProps = {
  onComplete: () => void;
};

/** Optional final signup step that turns the freshly proved account into a passkey account. */
export function PasskeySignUpCompletion({ onComplete }: PasskeySignUpCompletionProps) {
  const t = useT();
  const { addPasskey } = usePasskeys();
  const { pending, error, run } = useSubmitAction();

  return (
    <div className="ba-fields" data-testid="signup-passkey-completion">
      <h3 className="ba-title">{t('signUp.passkeyTitle')}</h3>
      <p className="ba-muted">{t('signUp.passkeyDescription')}</p>
      <FormError>{error}</FormError>
      <button
        className="ba-button"
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          void run(() => addPasskey(), {
            failure: t('signUp.error.passkeyFailed'),
            onSuccess: onComplete,
          })
        }
      >
        <Busy busy={pending} label={t('passkey.waiting')}>{t('signUp.passkeySubmit')}</Busy>
      </button>
      <button className="ba-link-button" type="button" disabled={pending} onClick={onComplete}>
        {t('signUp.passkeySkip')}
      </button>
    </div>
  );
}
