'use client';
import * as React from 'react';
import { useAuthClient, useSignIn } from '../hooks';
import { finishSignIn } from './finish-sign-in';

type PublicKeyCredentialLike = {
  isConditionalMediationAvailable?: () => Promise<boolean>;
};

/**
 * Arm passkey conditional mediation (browser autofill) when the platform
 * supports it. Best-effort progressive enhancement: the caller must render an
 * input whose `autocomplete` includes `webauthn` for the browser to surface
 * passkeys inline; if conditional mediation is unavailable or the ceremony
 * fails, the explicit <PasskeyButton/> still works.
 *
 * On success the user is signed in silently, so we run the same
 * onSignedIn/redirect handling as an explicit sign-in. `redirectTo`/`onSignedIn`
 * are read through a ref so an inline callback identity cannot re-arm (and abort)
 * the conditional request every render.
 */
export function usePasskeyAutofill(opts: {
  enabled: boolean;
  redirectTo?: string;
  onSignedIn?: () => void;
}): void {
  const { signInPasskey } = useSignIn();
  const { sessionStore } = useAuthClient();
  const { enabled } = opts;
  // Capture callbacks AND the action through a ref: the underlying client can
  // hand back a fresh function reference per access, so keying the effect on it
  // would re-arm (and abort) conditional mediation on every render. The effect
  // instead arms exactly once per enable-transition.
  const ref = React.useRef({ ...opts, signInPasskey, sessionStore });
  ref.current = { ...opts, signInPasskey, sessionStore };

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const pkc = (window as unknown as { PublicKeyCredential?: PublicKeyCredentialLike })
      .PublicKeyCredential;
    if (!pkc?.isConditionalMediationAvailable) return;

    let cancelled = false;
    pkc
      .isConditionalMediationAvailable()
      .then((available) =>
        cancelled || !available ? undefined : ref.current.signInPasskey({ autoFill: true }),
      )
      .then((res) => {
        if (cancelled || !res || res.error || !res.data) return;
        void finishSignIn(ref.current);
      })
      .catch(() => {
        /* autofill is a progressive enhancement; the explicit button remains */
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
