'use client';
import * as React from 'react';
import { useAuthClient, useSignIn } from '../hooks';
import { useT } from '../i18n';
import { finishSignIn } from './finish-sign-in';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type PasskeyButtonProps = {
  redirectTo?: string;
  /** Called after a passkey ceremony issues a session. */
  onSignedIn?: () => void;
};

/**
 * Explicit passkey (WebAuthn) sign-in: opens the browser's passkey prompt on
 * click. Complements the inline conditional-mediation autofill armed by
 * <SignIn/> - the button always works even where autofill is unavailable.
 */
export function PasskeyButton({ redirectTo, onSignedIn }: PasskeyButtonProps) {
  const t = useT();
  const { sessionStore } = useAuthClient();
  const { signInPasskey } = useSignIn();
  const { pending, error, run } = useSubmitAction();

  return (
    <div className="ba-fields">
      <button
        type="button"
        className="ba-social-button"
        disabled={pending}
        aria-busy={pending || undefined}
        data-testid="passkey-button"
        onClick={() =>
          void run(() => signInPasskey(), {
            failure: t('passkey.error.signInFailed'),
            // A dismissed prompt resolves with no data and no error - not a failure.
            onSuccess: (res) => {
              if (res.data) return finishSignIn({ sessionStore, redirectTo, onSignedIn });
            },
          })
        }
      >
        <Busy busy={pending} label={t('passkey.waiting')}>{t('passkey.signInButton')}</Busy>
      </button>
      <FormError>{error}</FormError>
    </div>
  );
}
