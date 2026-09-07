'use client';
import * as React from 'react';
import { useAuthClient, usePublicConfig, useSignIn } from '../hooks';
import { passkeyBlockingDomain } from '../signin-methods';
import { currentPageHost } from './page-host';
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
  // <SignIn/> renders this behind `plan.passkey`, which already asks this
  // question - but the component is exported, and a consumer who mounts it
  // directly got a button whose ceremony the browser refuses outright. Nothing
  // useful can be said here, so it renders nothing: this is a sign-in METHOD,
  // and the page offers others.
  const { config } = usePublicConfig();
  const blocked = passkeyBlockingDomain(config, currentPageHost()) !== undefined;
  if (blocked) return null;

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
