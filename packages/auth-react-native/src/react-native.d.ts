/**
 * Minimal ambient declarations for the React Native primitives these components
 * use.
 *
 * `react-native` is a PEER dependency, so it is not installed in this monorepo
 * and `tsc --noEmit` would otherwise fail in CI. Declaring only the members
 * actually used keeps the build honest without vendoring React Native's full
 * type surface - and if one of these signatures changes, the mismatch surfaces
 * in a consuming app's build rather than being papered over by `any`.
 *
 * Installing `react-native` here purely to typecheck was rejected: it is a very
 * large dependency that ships untranspiled Flow-typed source, which the repo's
 * vitest setup cannot parse. `react-native-web` was rejected too - it pulls in
 * `ua-parser-js`, a package with a documented takeover history, and the repo's
 * supply-chain policy correctly refuses it. Tests instead alias `react-native`
 * to a small local stub (see `test/react-native-stub.tsx`).
 */

declare module 'react-native' {
  import type { ComponentType, ReactNode, Ref } from 'react';

  /** Loosely typed on purpose: these components never introspect a style. */
  export type StyleProp = Record<string, unknown> | Array<unknown> | undefined | null | false;

  export interface ViewProps {
    style?: StyleProp;
    children?: ReactNode;
    testID?: string;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
    pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  }
  export const View: ComponentType<ViewProps>;

  export interface TextProps extends ViewProps {
    numberOfLines?: number;
    onPress?: () => void;
  }
  export const Text: ComponentType<TextProps>;

  export interface TextInputProps {
    style?: StyleProp;
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    placeholderTextColor?: string;
    onChangeText?: (text: string) => void;
    onSubmitEditing?: () => void;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    autoCorrect?: boolean;
    autoComplete?: string;
    textContentType?: string;
    keyboardType?: string;
    secureTextEntry?: boolean;
    editable?: boolean;
    maxLength?: number;
    testID?: string;
    accessibilityLabel?: string;
    returnKeyType?: string;
    ref?: Ref<unknown>;
  }
  export const TextInput: ComponentType<TextInputProps>;

  export interface PressableProps extends ViewProps {
    onPress?: () => void;
    disabled?: boolean;
    hitSlop?: number | { top?: number; right?: number; bottom?: number; left?: number };
    accessibilityState?: { disabled?: boolean; busy?: boolean; checked?: boolean };
  }
  export const Pressable: ComponentType<PressableProps>;

  export interface ActivityIndicatorProps {
    size?: 'small' | 'large';
    color?: string;
    testID?: string;
  }
  export const ActivityIndicator: ComponentType<ActivityIndicatorProps>;

  export const StyleSheet: {
    create<T extends Record<string, Record<string, unknown>>>(styles: T): T;
    flatten(style: StyleProp): Record<string, unknown>;
  };

  export const I18nManager: { isRTL: boolean };
  export const Linking: { openURL(url: string): Promise<unknown> };
}
