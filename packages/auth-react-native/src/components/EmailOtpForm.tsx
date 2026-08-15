/** Passwordless sign-in with an emailed one-time code. */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { useServerError, useT } from '../i18n';
import { useAuthOwlClient } from '../provider';
import { Field, FormError, SubmitButton, useStyles } from './primitives';
import { defaultTheme, type AuthOwlTheme } from './theme';

export interface EmailOtpFormProps {
  onSignedIn?: () => void;
  theme?: AuthOwlTheme;
}

/**
 * Two stages in one screen: request a code, then verify it.
 *
 * Kept together because the second stage is meaningless without the address
 * entered in the first, and splitting them across screens loses that context on
 * a back navigation.
 */
export function EmailOtpForm({ onSignedIn, theme = defaultTheme }: EmailOtpFormProps) {
  const t = useT();
  const toMessage = useServerError();
  const client = useAuthOwlClient();
  const styles = useStyles(theme);

  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    if (busy || email.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const result = await client.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: 'sign-in',
    });
    setBusy(false);

    if (result.error !== null) {
      setError(toMessage(result.error, 'emailOtp.error.sendFailed'));
      return;
    }
    setStage('code');
  }

  async function verifyCode() {
    if (busy || code.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const result = await client.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
    setBusy(false);

    if (result.error !== null) {
      setError(toMessage(result.error, 'emailOtp.error.invalidCode'));
      return;
    }
    onSignedIn?.();
  }

  function changeEmail() {
    // Drop the code as well: keeping it would carry a code minted for the old
    // address into a request for a new one, which can only ever fail.
    setStage('email');
    setCode('');
    setError(null);
  }

  if (stage === 'email') {
    return (
      <View style={styles.container} testID="authowl-emailotp">
        <Field
          label={t('common.emailLabel')}
          value={email}
          onChangeText={setEmail}
          theme={theme}
          editable={!busy}
          testID="authowl-emailotp-email"
          autoComplete="email"
          keyboardType="email-address"
          onSubmitEditing={requestCode}
        />
        <FormError message={error} theme={theme} />
        <SubmitButton
          label={t('emailOtp.requestSubmit')}
          busyLabel={t('common.sending')}
          onPress={requestCode}
          busy={busy}
          disabled={email.trim().length === 0}
          theme={theme}
          testID="authowl-emailotp-request"
        />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="authowl-emailotp">
      <Field
        label={t('emailOtp.codeLabel', { email: email.trim() })}
        value={code}
        onChangeText={setCode}
        theme={theme}
        editable={!busy}
        testID="authowl-emailotp-code"
        // One-time codes are numeric and should reach the keychain autofill.
        keyboardType="number-pad"
        autoComplete="one-time-code"
        onSubmitEditing={verifyCode}
      />
      <FormError message={error} theme={theme} />
      <SubmitButton
        label={t('emailOtp.verifySubmit')}
        busyLabel={t('common.verifying')}
        onPress={verifyCode}
        busy={busy}
        disabled={code.trim().length === 0}
        theme={theme}
        testID="authowl-emailotp-verify"
      />
      <Text style={styles.link} onPress={changeEmail} testID="authowl-emailotp-change">
        {t('emailOtp.changeEmail')}
      </Text>
    </View>
  );
}
