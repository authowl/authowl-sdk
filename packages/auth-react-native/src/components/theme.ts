/**
 * Visual tokens for the built-in components.
 *
 * Deliberately small and overridable rather than a full theming engine: an app
 * that wants its own look should compose the headless hooks, not fight a
 * cascade. These exist so the drop-in screens look deliberate out of the box.
 */

import { StyleSheet } from 'react-native';

export interface AuthOwlTheme {
  accent: string;
  accentText: string;
  /** Readable inline-link color; defaults to `accent` for custom themes. */
  link?: string;
  text: string;
  mutedText: string;
  background: string;
  surface: string;
  border: string;
  danger: string;
  radius: number;
  spacing: number;
}

export const defaultTheme: AuthOwlTheme = {
  accent: '#F5B84C',
  accentText: '#241703',
  link: '#624A1E',
  text: '#111827',
  mutedText: '#6b7280',
  background: '#ffffff',
  surface: '#f9fafb',
  border: '#d1d5db',
  danger: '#b91c1c',
  radius: 10,
  spacing: 12,
};

export const darkTheme: AuthOwlTheme = {
  ...defaultTheme,
  link: '#F5B84C',
  text: '#f9fafb',
  mutedText: '#9ca3af',
  background: '#111827',
  surface: '#1f2937',
  border: '#374151',
  danger: '#fca5a5',
};

/** Build the stylesheet for a theme. Memoize per theme at the call site. */
export function createStyles(theme: AuthOwlTheme) {
  return StyleSheet.create({
    container: { gap: theme.spacing, backgroundColor: theme.background },
    title: { fontSize: 22, fontWeight: '600', color: theme.text },
    label: { fontSize: 13, fontWeight: '500', color: theme.mutedText },
    field: { gap: 4 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radius,
      paddingHorizontal: theme.spacing,
      paddingVertical: theme.spacing * 0.75,
      fontSize: 16,
      color: theme.text,
      backgroundColor: theme.surface,
    },
    inputInvalid: { borderColor: theme.danger },
    button: {
      borderRadius: theme.radius,
      paddingVertical: theme.spacing,
      alignItems: 'center',
      backgroundColor: theme.accent,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: theme.accentText, fontSize: 16, fontWeight: '600' },
    link: { color: theme.link ?? theme.accent, fontSize: 14 },
    consentRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    consentToggle: {
      minWidth: 24,
      height: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    consentBox: {
      width: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 4,
      backgroundColor: theme.surface,
    },
    consentBoxChecked: {
      borderColor: theme.accent,
      backgroundColor: theme.accent,
    },
    consentBoxDisabled: { opacity: 0.55 },
    consentCheck: {
      color: theme.accentText,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 16,
    },
    consentText: {
      flex: 1,
      color: theme.text,
      fontSize: 13,
      lineHeight: 19,
    },
    consentLink: {
      color: theme.link ?? theme.accent,
      textDecorationLine: 'underline',
    },
    error: { color: theme.danger, fontSize: 14 },
  });
}
