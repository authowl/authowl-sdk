'use client';
import { useAuthClient, useSignIn } from '../hooks';
import { useT } from '../i18n';
import { finishSignIn } from './finish-sign-in';
import type { UseSubmitActionResult } from './use-submit-action';

export function usePasskeySignIn(run: UseSubmitActionResult['run'], redirectTo?: string, onSignedIn?: () => void) {
  const { sessionStore } = useAuthClient();
  const { signInPasskey } = useSignIn();
  const t = useT();
  return () => void run(signInPasskey, {
    failure: t('passkey.error.signInFailed'),
    // Dismissing the browser prompt resolves without data and is not a failure.
    onSuccess: (res) => {
      if (res.data) return finishSignIn({ sessionStore, redirectTo, onSignedIn });
    },
  });
}
