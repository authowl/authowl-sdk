'use client';
import { useSlot } from '../elements';
import * as React from 'react';
import { usePublicConfig } from '../hooks';
import { passkeyBlockingDomain } from '../signin-methods';
import { currentPageHost } from './page-host';
import { useT } from '../i18n';
import { usePasskeySignIn } from './use-passkey-sign-in';
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
  const slot = useSlot();
  const t = useT();
  const { pending, error, run } = useSubmitAction();
  const signIn = usePasskeySignIn(run, redirectTo, onSignedIn);
  // <SignIn/> renders this behind `plan.passkey`, which already asks this
  // question - but the component is exported, and a consumer who mounts it
  // directly got a button whose ceremony the browser refuses outright. Nothing
  // useful can be said here, so it renders nothing: this is a sign-in METHOD,
  // and the page offers others.
  const { config, isLoading: configLoading, isError: configError } = usePublicConfig();
  const configPending = configLoading || (config === null && !configError);
  const blocked = passkeyBlockingDomain(config, currentPageHost()) !== undefined;
  if (configPending || blocked) return null;

  return (
    <div className={slot('ba-fields')}>
      <button
        type="button"
        className={slot('ba-social-button')}
        disabled={pending}
        aria-busy={pending || undefined}
        data-testid="passkey-button"
        onClick={signIn}
      >
        <Busy busy={pending} label={t('passkey.waiting')}>{t('passkey.signInButton')}</Busy>
      </button>
      <FormError>{error}</FormError>
    </div>
  );
}
