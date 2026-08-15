/** Drop-in email/password sign-in screen. */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { useServerError, useT } from '../i18n';
import { resolveProjectCapabilities } from '@authowl/core/native';

import { useAuthOwlClient, usePublicConfig } from '../provider';
import { Field, FormError, SubmitButton, useStyles } from './primitives';
import { defaultTheme, type AuthOwlTheme } from './theme';

export interface SignInProps {
  /** Called once a session exists. */
  onSignedIn?: () => void;
  /** Called when valid credentials require an MFA challenge before a session exists. */
  onSecondFactorRequired?: () => void;
  /** Rendered as a link under the form, when provided. */
  onForgotPassword?: () => void;
  theme?: AuthOwlTheme;
}

/**
 * Email and password sign-in.
 *
 * Social sign-in is intentionally NOT rendered here. It needs a provider ID
 * token from a native SDK the app has to configure itself, so a button that
 * cannot work without that wiring would be a broken affordance. Use
 * `useSocialSignIn()` alongside this screen.
 */
export function SignIn({
  onSignedIn,
  onSecondFactorRequired,
  onForgotPassword,
  theme = defaultTheme,
}: SignInProps) {
  const t = useT();
  const toMessage = useServerError();
  const client = useAuthOwlClient();
  const config = usePublicConfig();
  const capabilities = resolveProjectCapabilities(config.data);
  const styles = useStyles(theme);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function submit() {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.signIn.email({ email: email.trim(), password });
      if (result.error !== null) {
        setError(toMessage(result.error, 'signIn.error.failed'));
        return;
      }
      if (result.data !== null && 'twoFactorRedirect' in result.data) {
        onSecondFactorRequired?.();
        return;
      }
      onSignedIn?.();
    } catch {
      setError(t('signIn.error.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (config.isLoading || (config.data !== null && !capabilities.passwordSignIn)) return null;

  return (
    <View style={styles.container} testID="authowl-signin">
      <Text style={styles.title}>{t('signIn.title')}</Text>

      <Field
        label={t('common.emailLabel')}
        value={email}
        onChangeText={setEmail}
        theme={theme}
        editable={!busy}
        testID="authowl-signin-email"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Field
        label={t('common.passwordLabel')}
        value={password}
        onChangeText={setPassword}
        theme={theme}
        secure
        editable={!busy}
        testID="authowl-signin-password"
        autoComplete="current-password"
        onSubmitEditing={submit}
      />

      <FormError message={error} theme={theme} />

      <SubmitButton
        label={t('signIn.submit')}
        busyLabel={t('signIn.submitPending')}
        onPress={submit}
        busy={busy}
        disabled={!canSubmit}
        theme={theme}
        testID="authowl-signin-submit"
      />

      {onForgotPassword ? (
        <Text style={styles.link} onPress={onForgotPassword} testID="authowl-signin-forgot">
          {t('signIn.forgotLink')}
        </Text>
      ) : null}
    </View>
  );
}
