/**
 * AuthOwl for React Native.
 *
 * Wraps `@authowl/core/native` with the two things a phone needs and a browser
 * gets for free: a session that survives an app restart (a cookie jar over the
 * OS keychain). Social sign-in exchanges ID tokens from provider-native SDKs.
 *
 * ```tsx
 * <AuthOwlProvider
 *   publishableKey={PUBLISHABLE_KEY}
 *   apiUrl="https://api.authowl.dev"
 *   storage={keychainStorage}
 * >
 *   <App />
 * </AuthOwlProvider>
 * ```
 */

export { createAuthOwlNative } from './client';
export type {
  AuthOwlHeadlessNative,
  AuthOwlNative,
  AuthOwlNativeConfig,
  AuthOwlNativeConfigWithPasskeys,
  AuthOwlPasskeyNative,
} from './client';
export { createCookieJarFetch, readSetCookie, sessionStorageKey } from './cookie-jar';
export type { CookieJarOptions } from './cookie-jar';
export { signInWithSocialIdToken } from './oauth';
export type {
  SocialIdTokenSignInOptions,
} from './oauth';
export {
  AuthOwlProvider,
  useAuth,
  useAuthOwlClient,
  useAuthOwlLocale,
  usePublicConfig,
  useSession,
  useSocialSignIn,
  useUser,
} from './provider';
export type { AuthOwlProviderProps, PublicConfigState, UseAuthResult } from './provider';
export { SignIn } from './components/SignIn';
export type { SignInProps } from './components/SignIn';
export { SignUp } from './components/SignUp';
export type { SignUpProps } from './components/SignUp';
export { EmailOtpForm } from './components/EmailOtpForm';
export type { EmailOtpFormProps } from './components/EmailOtpForm';
export { OrganizationSwitcher } from './components/OrganizationSwitcher';
export type { OrganizationSwitcherProps } from './components/OrganizationSwitcher';
export { PasskeyEnrollment, PasskeySignInButton } from './components/PasskeyEnrollment';
export type {
  PasskeyEnrollmentProps,
  PasskeySignInButtonProps,
} from './components/PasskeyEnrollment';
export { createNativePasskeys } from './passkeys';
export type { NativePasskeyAdapter } from './passkeys';
export { SocialButtons } from './components/SocialButtons';
export type {
  ProviderIdToken,
  SocialButtonsProps,
  SocialProvider,
} from './components/SocialButtons';
export { Field, FormError, SubmitButton, useStyles } from './components/primitives';
export type { FieldProps, SubmitButtonProps } from './components/primitives';
export { createStyles, darkTheme, defaultTheme } from './components/theme';
export type { AuthOwlTheme } from './components/theme';
export { useLocale, useServerError, useT } from './i18n';
export type { Locale, MessageKey, MessageParams } from './i18n';
export { MemoryStorage } from './storage';
export type { SecureStorage } from './storage';
export { sessionCookieName } from '@authowl/core/native';
export type {
  AuthSession,
  AuthUser,
  HasParams,
  NativeAuthClient,
  NativeSocialSignInOptions,
  OrganizationMembership,
  SessionState,
} from '@authowl/core/native';
