'use client';
import type { LastUsedSignInMethod } from '@authowl/core';
import { useSubmitAction } from './use-submit-action';
import { useAuthCardPending } from './AuthCardLock';
import { useSlot } from '../elements';
import * as React from 'react';
import { useSignIn } from '../hooks';
import { useSignInMethodRecorder, useLastUsedSignInMethod } from '../last-used-method';
import { useT } from '../i18n';
import { ProviderIcon } from './social-icons';
import { Busy } from './Spinner';
import { FormError } from './FormError';

const LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  gitlab: 'GitLab',
  apple: 'Apple',
  facebook: 'Facebook',
  microsoft: 'Microsoft',
  discord: 'Discord',
  twitter: 'X',
  spotify: 'Spotify',
  twitch: 'Twitch',
};

function label(id: string): string {
  return LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export type SocialButtonsProps = {
  providers: string[];
  /** Where to send the browser after the OAuth round-trip. */
  callbackURL?: string;
  /** Reuse the enclosing form's hint; omitted for standalone storage lookup. */
  lastUsed?: LastUsedSignInMethod | null;
  /** Registration copy without sign-in history hints. */
  signUp?: boolean;
};

/**
 * Renders one "Continue with <provider>" button per configured social provider.
 * A social sign-in also creates the account on first use, so this is shared by
 * both <SignIn/> and <SignUp/>.
 */
export function SocialButtons({ providers, callbackURL, lastUsed: hint, signUp = false }: SocialButtonsProps) {
  const slot = useSlot();
  const t = useT();
  const { signInSocial } = useSignIn();
  const storedHint = useLastUsedSignInMethod(!signUp && hint === undefined);
  const hintId = React.useId();
  const lastUsed = hint === undefined ? storedHint : hint;
  const recordSignInMethod = useSignInMethodRecorder();
  const [activeProvider, setActiveProvider] = React.useState<string | null>(null);
  const { pending, error, setError, run } = useSubmitAction();

  const locked = useAuthCardPending(pending);

  // useSubmitAction resets pending on a persisted pageshow. Clear the provider
  // alongside it, including after a failed redirect start.
  React.useEffect(() => {
    if (!pending) setActiveProvider(null);
  }, [pending]);

  // A social sign-in now begins with a NAVIGATION, so a failure to start cannot
  // come back as a return value - it arrives as `?error=` on the page the flow
  // was told to fail to. Read it once, then take it out of the URL so a refresh
  // does not resurrect it.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    // Namespaced, and only ours. A bare `error` belongs to the tenant's app as
    // much as to us, and deleting theirs - or rendering a sign-in failure for an
    // unrelated one - is not ours to do.
    if (!url.searchParams.has('authowl_error')) return;
    url.searchParams.delete('authowl_error');
    window.history.replaceState(window.history.state, '', url.toString());
    setError(t('social.error.startFailed'));
  }, [t, setError]);

  if (providers.length === 0) return null;

  return (
    <div className={slot('ba-social')} style={{ '--ao-social-columns': Math.min(providers.length, 3) } as React.CSSProperties}>
      {providers.map((provider) => {
        const busy = pending && activeProvider === provider;
        const used = !signUp && lastUsed === `social:${provider}`;
        const descriptionId = `${hintId}-${provider}`;
        return (
          <button
            key={provider}
            type="button"
            aria-label={busy ? t('social.redirecting') : t(signUp ? 'social.signUpWith' : 'social.continueWith', { provider: label(provider) })}
            aria-describedby={used ? descriptionId : undefined}
            className={slot('ba-social-button')}
            disabled={locked}
            aria-busy={busy || undefined}
            onClick={() => {
              if (locked) return;
              setActiveProvider(provider);
              // OAuth leaves the application; return here to redeem the handoff.
              // Legacy transports can return an error instead of navigating.
              void run(() => signInSocial({
                provider,
                callbackURL: callbackURL ?? window.location.href,
                errorCallbackURL: window.location.href,
              }), {
                failure: t('social.error.startFailed'),
                // Park only after redirect start succeeds. Promotion waits for a
                // session on return, so abandoned consent never teaches the hint.
                onSuccess: () => recordSignInMethod(`social:${provider}`, true),
                keepPendingOnSuccess: true,
              });
            }}
          >
            <Busy busy={busy} label={t('social.redirecting')}>
              <ProviderIcon provider={provider} />
              {label(provider)}
            </Busy>
            {used && <span id={descriptionId} className={slot('ba-last-used')}>{t('signIn.lastUsed')}</span>}
          </button>
        );
      })}
      <FormError>{error}</FormError>
    </div>
  );
}
