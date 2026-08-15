/** Enrol a platform passkey, and sign in with one. */

import { useState } from 'react';
import { Text, View } from 'react-native';

import type { NativePasskeyCapableClient } from '@authowl/core/native';

import { useServerError, useT } from '../i18n';
import { resolveProjectCapabilities } from '@authowl/core/native';

import { useAuthOwlClient, usePublicConfig } from '../provider';
import { FormError, SubmitButton, useStyles } from './primitives';
import { defaultTheme, type AuthOwlTheme } from './theme';

/**
 * Narrow the client to its passkey-capable shape.
 *
 * Returns null when the app did not pass a `passkeys` adapter to
 * `<AuthOwlProvider>`. These components then render nothing rather than
 * offering a prompt the platform can never show.
 */
function usePasskeyClient(): NativePasskeyCapableClient | null {
  const client = useAuthOwlClient();
  return 'addPasskey' in client.passkey
    ? (client as NativePasskeyCapableClient)
    : null;
}

export interface PasskeyEnrollmentProps {
  /** Suggested credential name, shown in the platform's list. */
  name?: string;
  onEnrolled?: () => void;
  /** Rendered as a skip link when provided. */
  onSkip?: () => void;
  theme?: AuthOwlTheme;
}

/**
 * Offer to create a passkey.
 *
 * Renders nothing without a passkey adapter, so it is safe to drop into a
 * post-sign-up flow that also runs on projects with passkeys disabled.
 */
export function PasskeyEnrollment({
  name,
  onEnrolled,
  onSkip,
  theme = defaultTheme,
}: PasskeyEnrollmentProps) {
  const t = useT();
  const toMessage = useServerError();
  const client = usePasskeyClient();
  const config = usePublicConfig();
  const capabilities = resolveProjectCapabilities(config.data);
  const styles = useStyles(theme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (client === null || config.isLoading || (config.data !== null && !capabilities.passkeyAdd)) {
    return null;
  }

  async function enrol() {
    if (busy || client === null) return;
    setBusy(true);
    setError(null);
    const result = await client.passkey.addPasskey(name === undefined ? {} : { name });
    setBusy(false);

    if (result.error !== null) {
      setError(toMessage(result.error, 'signUp.error.passkeyFailed'));
      return;
    }
    onEnrolled?.();
  }

  return (
    <View style={styles.container} testID="authowl-passkey-enrollment">
      <Text style={styles.title}>{t('signUp.passkeyTitle')}</Text>
      <Text style={styles.label}>{t('signUp.passkeyDescription')}</Text>

      <FormError message={error} theme={theme} testID="authowl-passkey-error" />

      <SubmitButton
        label={t('signUp.passkeySubmit')}
        busyLabel={t('passkey.waiting')}
        onPress={() => void enrol()}
        busy={busy}
        theme={theme}
        testID="authowl-passkey-submit"
      />

      {onSkip ? (
        <Text style={styles.link} onPress={onSkip} testID="authowl-passkey-skip">
          {t('signUp.passkeySkip')}
        </Text>
      ) : null}
    </View>
  );
}

export interface PasskeySignInButtonProps {
  onSignedIn?: () => void;
  theme?: AuthOwlTheme;
}

/** Sign in with an already-enrolled passkey. */
export function PasskeySignInButton({
  onSignedIn,
  theme = defaultTheme,
}: PasskeySignInButtonProps) {
  const t = useT();
  const toMessage = useServerError();
  const client = usePasskeyClient();
  const config = usePublicConfig();
  const capabilities = resolveProjectCapabilities(config.data);
  const styles = useStyles(theme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    client === null
    || config.isLoading
    || (config.data !== null && !capabilities.passkeySignIn)
  ) return null;

  async function signIn() {
    if (busy || client === null) return;
    setBusy(true);
    setError(null);
    const result = await client.signIn.passkey();
    setBusy(false);

    if (result.error !== null) {
      setError(toMessage(result.error, 'passkey.error.signInFailed'));
      return;
    }
    onSignedIn?.();
  }

  return (
    <View style={styles.container} testID="authowl-passkey-signin">
      <SubmitButton
        label={t('passkey.signInButton')}
        busyLabel={t('passkey.waiting')}
        onPress={() => void signIn()}
        busy={busy}
        theme={theme}
        testID="authowl-passkey-signin-submit"
      />
      <FormError message={error} theme={theme} testID="authowl-passkey-signin-error" />
    </View>
  );
}
