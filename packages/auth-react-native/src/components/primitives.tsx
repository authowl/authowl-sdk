/** Shared building blocks for the built-in auth screens. */

import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createStyles, defaultTheme, type AuthOwlTheme } from './theme';

export function useStyles(theme: AuthOwlTheme = defaultTheme) {
  return useMemo(() => createStyles(theme), [theme]);
}

export interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  theme?: AuthOwlTheme;
  placeholder?: string;
  secure?: boolean;
  invalid?: boolean;
  editable?: boolean;
  testID?: string;
  autoComplete?: string;
  keyboardType?: string;
  maxLength?: number;
  onSubmitEditing?: () => void;
}

/** A labelled text input. */
export function Field({
  label,
  value,
  onChangeText,
  theme = defaultTheme,
  placeholder,
  secure = false,
  invalid = false,
  editable = true,
  testID,
  autoComplete,
  keyboardType,
  maxLength,
  onSubmitEditing,
}: FieldProps) {
  const styles = useStyles(theme);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={invalid ? [styles.input, styles.inputInvalid] : styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.mutedText}
        secureTextEntry={secure}
        editable={editable}
        testID={testID}
        // Never autocapitalize or autocorrect a credential: an autocapitalized
        // email or password is a sign-in failure the user cannot see.
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        maxLength={maxLength}
        accessibilityLabel={label}
        onSubmitEditing={onSubmitEditing}
      />
    </View>
  );
}

export interface SubmitButtonProps {
  label: string;
  busyLabel: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  theme?: AuthOwlTheme;
  testID?: string;
}

/** The primary action, with its own busy state. */
export function SubmitButton({
  label,
  busyLabel,
  onPress,
  busy = false,
  disabled = false,
  theme = defaultTheme,
  testID,
}: SubmitButtonProps) {
  const styles = useStyles(theme);
  const blocked = busy || disabled;
  return (
    <Pressable
      style={blocked ? [styles.button, styles.buttonDisabled] : styles.button}
      onPress={onPress}
      disabled={blocked}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
    >
      {busy ? <ActivityIndicator color={theme.accentText} /> : null}
      <Text style={styles.buttonText}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

/**
 * An error message.
 *
 * Announced politely so a screen reader reports a failed sign-in without
 * interrupting whatever the user is doing.
 */
export function FormError({
  message,
  theme = defaultTheme,
  testID = 'authowl-error',
}: {
  message: string | null;
  theme?: AuthOwlTheme;
  testID?: string;
}) {
  const styles = useStyles(theme);
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite">
      <Text style={styles.error} testID={testID}>
        {message}
      </Text>
    </View>
  );
}
