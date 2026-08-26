'use client';
import * as React from 'react';
import type { AuthOwlErrorCode, AuthUser } from '@authowl/core';
import { usePublicConfig, useSignIn, useUser } from '../hooks';
import {
  GoogleOneTapRuntimeError,
  startGoogleOneTap,
  type GoogleOneTapHandle,
  type GoogleOneTapRuntimeErrorCode,
} from './google-one-tap';

export type GoogleOneTapSkipReason =
  | 'disabled'
  | 'existing_session'
  | 'provider_disabled'
  | 'prompt_skipped';

export type GoogleOneTapDismissReason =
  | 'tap_outside'
  | 'cancel_called'
  | 'flow_restarted'
  | 'unknown';

export type GoogleOneTapErrorCode =
  | GoogleOneTapRuntimeErrorCode
  | 'public_config_unavailable'
  | 'missing_client_id'
  | 'credential_missing'
  | 'credential_exchange_failed';

export type GoogleOneTapError = {
  code: GoogleOneTapErrorCode;
  status?: number;
  authCode?: AuthOwlErrorCode | (string & {});
};

export type GoogleOneTapProps = {
  /** Disable prompting without unmounting the component. */
  disabled?: boolean;
  /** Bind Google's ID token to this browser attempt. Generate a fresh random value server-side. */
  nonce?: string;
  /** Let eligible returning Google users sign in automatically. Defaults to false. */
  autoSelect?: boolean;
  /** Let tapping outside dismiss the prompt. Defaults to true. */
  cancelOnTapOutside?: boolean;
  /** Wording Google uses in the prompt. */
  context?: 'signin' | 'signup' | 'use';
  /** Enable Google's upgraded experience on ITP browsers. Defaults to true. */
  itpSupport?: boolean;
  loginHint?: string;
  hostedDomain?: string;
  stateCookieDomain?: string;
  /** CSP nonce applied only when AuthOwl inserts the Google Identity script. */
  scriptNonce?: string;
  onSignedIn?: (user: AuthUser) => void;
  onSkipped?: (reason: GoogleOneTapSkipReason) => void;
  onDismissed?: (reason: GoogleOneTapDismissReason) => void;
  onError?: (error: GoogleOneTapError) => void;
};

function normalizeDismissReason(reason: string): GoogleOneTapDismissReason {
  if (reason === 'tap_outside' || reason === 'cancel_called' || reason === 'flow_restarted') {
    return reason;
  }
  return 'unknown';
}

/**
 * Warn once per mount site when One Tap runs without binding Google's ID token
 * to this attempt.
 *
 * Without a nonce, a token captured from one browser can be replayed from
 * another: Google will happily verify it, because nothing in it says which
 * attempt asked for it. The prop exists and the server forwards it - what was
 * missing is anything telling a developer the safe path is opt-in.
 *
 * Declared beside the call site so a consumer bundler eliminates it from
 * production, matching how the provider reports a failed config load.
 */
const warnedMissingNonce = new Set<string>();
function warnOneTapWithoutNonce(clientId: string): void {
  if (warnedMissingNonce.has(clientId)) return;
  warnedMissingNonce.add(clientId);
  console.warn(
    '[AuthOwl] <GoogleOneTap/> is running without a `nonce`. Google\u2019s ID token is ' +
      'then not bound to this sign-in attempt, so a captured token can be replayed from ' +
      'another browser. Generate a fresh random value per attempt server-side and pass ' +
      'it as `nonce`; AuthOwl forwards it to Google and verifies the match. ' +
      '(This warning is dev-only.)',
  );
}

/** Invisible, server-configured Google One Tap conversion helper. */
export function GoogleOneTap({
  disabled = false,
  nonce,
  autoSelect = false,
  cancelOnTapOutside = true,
  context = 'signin',
  itpSupport = true,
  loginHint,
  hostedDomain,
  stateCookieDomain,
  scriptNonce,
  onSignedIn,
  onSkipped,
  onDismissed,
  onError,
}: GoogleOneTapProps) {
  const { config, isLoading: configLoading, isError: configError } = usePublicConfig();
  const { user, isLoaded: sessionLoaded } = useUser();
  const { signInSocial } = useSignIn();
  const callbacks = React.useRef({ onSignedIn, onSkipped, onDismissed, onError });
  callbacks.current = { onSignedIn, onSkipped, onDismissed, onError };

  const googleEnabled = config?.socialProviders.includes('google') === true;
  const clientId = config?.socialProviderClientIds?.google;

  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (disabled || !googleEnabled || !clientId || nonce) return;
    warnOneTapWithoutNonce(clientId);
  }, [clientId, disabled, googleEnabled, nonce]);

  React.useEffect(() => {
    if (configLoading || !sessionLoaded) return;
    if (disabled) {
      callbacks.current.onSkipped?.('disabled');
      return;
    }
    if (user) {
      callbacks.current.onSkipped?.('existing_session');
      return;
    }
    if (configError) {
      callbacks.current.onError?.({ code: 'public_config_unavailable' });
      return;
    }
    if (!googleEnabled) {
      callbacks.current.onSkipped?.('provider_disabled');
      return;
    }
    if (!clientId) {
      callbacks.current.onError?.({ code: 'missing_client_id' });
      return;
    }

    let active = true;
    let exchanging = false;
    let handle: GoogleOneTapHandle | null = null;
    const abort = new AbortController();

    void startGoogleOneTap(
      {
        clientId,
        nonce,
        autoSelect,
        cancelOnTapOutside,
        context,
        itpSupport,
        loginHint,
        hostedDomain,
        stateCookieDomain,
        scriptNonce,
      },
      {
        onCredential: async (response) => {
          if (!active || exchanging) return;
          if (!response.credential) {
            callbacks.current.onError?.({ code: 'credential_missing' });
            return;
          }
          exchanging = true;
          let result;
          try {
            result = await signInSocial({
              provider: 'google',
              disableRedirect: true,
              idToken: { token: response.credential, ...(nonce ? { nonce } : {}) },
            });
          } catch {
            if (active) callbacks.current.onError?.({ code: 'credential_exchange_failed' });
            return;
          }
          if (!active) return;
          if (result?.error) {
            callbacks.current.onError?.({
              code: 'credential_exchange_failed',
              status: result.error.status,
              authCode: result.error.code,
            });
            return;
          }
          const data = result?.data;
          if (!data || !('user' in data)) {
            callbacks.current.onError?.({ code: 'credential_exchange_failed' });
            return;
          }
          callbacks.current.onSignedIn?.(data.user);
        },
        onSkipped: () => callbacks.current.onSkipped?.('prompt_skipped'),
        onDismissed: (reason) => callbacks.current.onDismissed?.(normalizeDismissReason(reason)),
      },
      abort.signal,
    )
      .then((started) => {
        if (!started) return;
        if (!active) started.cancel();
        else handle = started;
      })
      .catch((error: unknown) => {
        if (!active || abort.signal.aborted) return;
        callbacks.current.onError?.({
          code: error instanceof GoogleOneTapRuntimeError ? error.code : 'api_unavailable',
        });
      });

    return () => {
      active = false;
      abort.abort();
      handle?.cancel();
    };
  }, [
    autoSelect,
    cancelOnTapOutside,
    clientId,
    configError,
    configLoading,
    context,
    disabled,
    googleEnabled,
    hostedDomain,
    itpSupport,
    loginHint,
    nonce,
    scriptNonce,
    sessionLoaded,
    signInSocial,
    stateCookieDomain,
    user,
  ]);

  return null;
}
