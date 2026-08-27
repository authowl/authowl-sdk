'use client';
import * as React from 'react';
import { useSignIn } from '../hooks';
import { useSignInMethodRecorder } from '../last-used-method';
import { useT, useServerError } from '../i18n';
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
};

/**
 * Renders one "Continue with <provider>" button per configured social provider.
 * A social sign-in also creates the account on first use, so this is shared by
 * both <SignIn/> and <SignUp/>.
 */
export function SocialButtons({ providers, callbackURL }: SocialButtonsProps) {
  const t = useT();
  const toServerError = useServerError();
  const { signInSocial } = useSignIn();
  const recordSignInMethod = useSignInMethodRecorder();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
  }, [t]);

  if (providers.length === 0) return null;

  return (
    <div className="ba-social">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          className="ba-social-button"
          disabled={pending !== null}
          aria-busy={pending === provider || undefined}
          onClick={async () => {
            setError(null);
            setPending(provider);
            try {
              // OAuth leaves the application, so a zero-config drop-in must
              // remember where to return. Consumers can still override it for
              // a dedicated callback or post-authentication page.
              const destination = callbackURL ?? window.location.href;
              // On success the browser is redirected away (keep "Redirecting…").
              // Two failure shapes now. On the first-party transport the flow
              // starts with a navigation, so a start failure lands back HERE as
              // `?error=` (read above) - which only works because we name this
              // page as the error destination. On the legacy transport (React
              // Native, `disableRedirect`, or a call carrying `scopes`) the
              // action still returns `{ error }` and no redirect happens.
              const res = await signInSocial({
                provider,
                callbackURL: destination,
                errorCallbackURL: window.location.href,
              });
              if (res?.error) {
                setError(toServerError(res.error, t('social.error.startFailed')));
                setPending(null);
              } else {
                // Park only after the redirect start succeeds. A user who
                // bounces off consent has not signed in; promotion waits for a
                // session on return.
                recordSignInMethod(`social:${provider}`, true);
              }
            } catch {
              setError(t('social.error.startFailed'));
              setPending(null);
            }
          }}
        >
          <Busy busy={pending === provider} label={t('social.redirecting')}>
            <ProviderIcon provider={provider} />
            {t('social.continueWith', { provider: label(provider) })}
          </Busy>
        </button>
      ))}
      <FormError>{error}</FormError>
    </div>
  );
}
