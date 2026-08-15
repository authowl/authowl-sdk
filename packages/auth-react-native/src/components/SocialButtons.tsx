/** Social sign-in buttons over provider-issued ID tokens. */

import { useState } from 'react';
import { View } from 'react-native';

import { useServerError, useT } from '../i18n';
import { useAuthOwlClient } from '../provider';
import { FormError, SubmitButton, useStyles } from './primitives';
import { defaultTheme, type AuthOwlTheme } from './theme';

/** An ID token obtained from a provider's native SDK. */
export interface ProviderIdToken {
  token: string;
  accessToken?: string;
  nonce?: string;
}

export interface SocialProvider {
  /** The provider id AuthOwl knows, e.g. `google` or `apple`. */
  id: string;
  /** Display name, interpolated into the localized button label. */
  label: string;
  /**
   * Run the provider's native sign-in and return its ID token.
   *
   * Return `null` when the user cancels. The app owns this because the native
   * SDKs differ per provider and per platform, and bundling one would force
   * every consumer to carry it - `google_sign_in`, `expo-apple-authentication`,
   * and friends stay the app's dependency, not the SDK's.
   */
  getIdToken: () => Promise<ProviderIdToken | null>;
}

export interface SocialButtonsProps {
  providers: readonly SocialProvider[];
  onSignedIn?: () => void;
  theme?: AuthOwlTheme;
}

/**
 * One button per provider.
 *
 * Redirect OAuth is not an option here: it completes inside a system browser
 * whose cookie jar this client cannot read, so the session would land somewhere
 * the app can never see it. ID-token exchange is the only native flow that
 * actually establishes a session.
 */
export function SocialButtons({
  providers,
  onSignedIn,
  theme = defaultTheme,
}: SocialButtonsProps) {
  const t = useT();
  const toMessage = useServerError();
  const client = useAuthOwlClient();
  const styles = useStyles(theme);

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: SocialProvider) {
    if (pending !== null) return;
    setPending(provider.id);
    setError(null);
    try {
      const idToken = await provider.getIdToken();
      // A cancelled provider sheet is not a failure. Showing an error for a
      // deliberate dismissal is noise the user cannot act on.
      if (idToken === null) return;

      const result = await client.signIn.social({ provider: provider.id, idToken });
      if (result.error !== null) {
        setError(toMessage(result.error, 'social.error.startFailed'));
        return;
      }
      onSignedIn?.();
    } catch {
      setError(t('social.error.startFailed'));
    } finally {
      setPending(null);
    }
  }

  if (providers.length === 0) return null;

  return (
    <View style={styles.container} testID="authowl-social">
      {providers.map((provider) => (
        <SubmitButton
          key={provider.id}
          label={t('social.continueWith', { provider: provider.label })}
          busyLabel={t('social.redirecting')}
          onPress={() => {
            void signIn(provider);
          }}
          busy={pending === provider.id}
          // Every button locks while any provider is mid-flight: two concurrent
          // provider sheets would race to establish a session.
          disabled={pending !== null && pending !== provider.id}
          theme={theme}
          testID={`authowl-social-${provider.id}`}
        />
      ))}
      <FormError message={error} theme={theme} testID="authowl-social-error" />
    </View>
  );
}
