/**
 * A DOM stand-in for the React Native primitives, used only by tests.
 *
 * The components import from `react-native`, which is correct for consumers but
 * unusable here: React Native ships untranspiled Flow-typed source that vitest
 * cannot parse, and `react-native-web` - the usual shim - pulls in
 * `ua-parser-js`, a package with a documented takeover history that this repo's
 * supply-chain policy rightly refuses.
 *
 * So `vitest.config.ts` aliases `react-native` to this file. It is deliberately
 * tiny and dependency-free: enough to assert structure, text, disabled state,
 * and press/change behaviour in jsdom, and nothing more. It is NOT a rendering
 * fidelity harness - layout and native styling are verified on a device, not
 * here.
 */

import * as React from 'react';

type AnyProps = Record<string, unknown>;

function domProps({
  style: _style,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityLiveRegion: _accessibilityLiveRegion,
  pointerEvents: _pointerEvents,
  ...rest
}: AnyProps) {
  return {
    ...rest,
    'data-testid': testID,
    'aria-label': accessibilityLabel,
    role: accessibilityRole,
    style: undefined,
  };
}

export function View(props: AnyProps) {
  const { children, ...rest } = props;
  return React.createElement('div', domProps(rest), children as React.ReactNode);
}

export function Text(props: AnyProps) {
  const { children, onPress, ...rest } = props;
  return React.createElement(
    'span',
    { ...domProps(rest), onClick: onPress },
    children as React.ReactNode,
  );
}

export function TextInput(props: AnyProps) {
  const {
    onChangeText,
    value,
    secureTextEntry,
    editable,
    placeholderTextColor: _placeholderTextColor,
    autoCapitalize: _autoCapitalize,
    autoCorrect: _autoCorrect,
    textContentType: _textContentType,
    keyboardType: _keyboardType,
    onSubmitEditing: _onSubmitEditing,
    returnKeyType: _returnKeyType,
    ...rest
  } = props;
  return React.createElement('input', {
    ...domProps(rest),
    value: (value as string) ?? '',
    type: secureTextEntry ? 'password' : 'text',
    disabled: editable === false,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      (onChangeText as ((text: string) => void) | undefined)?.(event.target.value),
  });
}

export function Pressable(props: AnyProps) {
  const { children, onPress, disabled, accessibilityState, hitSlop: _hitSlop, ...rest } = props;
  return React.createElement(
    'button',
    {
      ...domProps(rest),
      type: 'button',
      disabled: Boolean(disabled),
      'aria-busy': (accessibilityState as { busy?: boolean } | undefined)?.busy,
      onClick: onPress,
    },
    children as React.ReactNode,
  );
}

export function ActivityIndicator(props: AnyProps) {
  return React.createElement('span', { ...domProps(props), 'data-busy': 'true' });
}

export const StyleSheet = {
  create: <T,>(styles: T): T => styles,
  flatten: (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style ?? {}),
};

export const I18nManager = { isRTL: false };
export const Linking = { openURL: async (_url: string) => undefined };
