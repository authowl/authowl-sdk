'use client';

export { AuthOwlProvider, useAuthOwlContext } from './provider';
// useT/richMessage stay INTERNAL: exporting them would freeze every catalog
// key into public API (renaming a key would become a breaking change).
export { useLocale, Bidi } from './i18n';
export type { AuthOwlProviderProps, Appearance, ConfigState } from './provider';

// The single default brand color shared by the SDK forms and the hosted account
// portal when an operator has not set one (the AuthOwl gold). The app imports
// this so both surfaces default identically - one source of truth (P1-5).
export { DEFAULT_BRAND_COLOR } from './brand';

export {
  useAuth,
  useAuthClient,
  useAccount,
  useSession,
  useUser,
  useOrganization,
  useSignIn,
  useSignUp,
  useSignOut,
  usePasskeys,
  usePasswordReset,
  useEmailVerification,
  useConsent,
  useMFA,
  usePublicConfig,
  useWaitlist,
} from './hooks';
export type {
  UseAuthResult,
  UseAccountResult,
  UseOrganizationResult,
  UsePublicConfigResult,
  UseWaitlistResult,
  UseSignInResult,
  UseSignUpResult,
  UseSignOutResult,
  UsePasskeysResult,
  UsePasswordResetResult,
  UseEmailVerificationResult,
  UseConsentResult,
  UseMFAResult,
  UseUserResult,
} from './hooks';

export { resolveSignInMethods, emailAutocomplete, KNOWN_METHODS } from './signin-methods';
export type { SignInPlan, KnownMethod, AutofillHost } from './signin-methods';

export { SignIn } from './components/SignIn';
export type { SignInProps } from './components/SignIn';
export { AuthOwlBranding } from './components/AuthOwlBranding';
export type { AuthOwlBrandingProps } from './components/AuthOwlBranding';
export { PhoneOTP } from './components/PhoneOTP';
export type { PhoneOTPProps } from './components/PhoneOTP';
export { SignUp } from './components/SignUp';
export type { SignUpProps } from './components/SignUp';
export { Waitlist } from './components/Waitlist';
export type { WaitlistProps } from './components/Waitlist';
export { ConsentGate } from './components/ConsentGate';
export { MFARequiredGate } from './components/MFARequiredGate';
export type { MFARequiredGateProps } from './components/MFARequiredGate';
export { BackupCodesManager } from './components/BackupCodesManager';
export type { BackupCodesManagerProps } from './components/BackupCodesManager';
export type { ConsentGateProps } from './components/ConsentGate';
export { ConsentDocLinks } from './components/ConsentDocLinks';
export type { ConsentDocLinksProps } from './components/ConsentDocLinks';
export { SocialButtons } from './components/SocialButtons';
export type { SocialButtonsProps } from './components/SocialButtons';
export { MagicLinkForm } from './components/MagicLinkForm';
export type { MagicLinkFormProps } from './components/MagicLinkForm';
export { EmailOtpForm } from './components/EmailOtpForm';
export type { EmailOtpFormProps } from './components/EmailOtpForm';
export { PasskeyButton } from './components/PasskeyButton';
export type { PasskeyButtonProps } from './components/PasskeyButton';
export { ForgotPassword } from './components/ForgotPassword';
export type { ForgotPasswordProps } from './components/ForgotPassword';
export { ResetPassword } from './components/ResetPassword';
export type { ResetPasswordProps } from './components/ResetPassword';
export { VerifyEmail } from './components/VerifyEmail';
export type { VerifyEmailProps } from './components/VerifyEmail';
export { VerificationPending } from './components/VerificationPending';
export type { VerificationPendingProps } from './components/VerificationPending';
export { PasskeyManager } from './components/PasskeyManager';
export type { PasskeyManagerProps } from './components/PasskeyManager';
export { MFAEnrollment } from './components/MFAEnrollment';
export type { MFAEnrollmentProps } from './components/MFAEnrollment';
export { MFAChallenge } from './components/MFAChallenge';
export type { MFAChallengeProps } from './components/MFAChallenge';
export { AuthOwlBadge } from './components/AuthOwlBadge';
export type { AuthOwlBadgeProps } from './components/AuthOwlBadge';
export { SignedIn, SignedOut, Protect, AuthLoading, AuthLoaded } from './components/control';
export type {
  SignedInProps,
  SignedOutProps,
  ProtectProps,
  AuthLoadingProps,
  AuthLoadedProps,
} from './components/control';
export { Spinner } from './components/Spinner';
export { SignOutButton } from './components/SignOutButton';
export type { SignOutButtonProps } from './components/SignOutButton';
export { UserButton } from './components/UserButton';
export { UserProfile } from './components/UserProfile';
export type { UserProfileProps } from './components/UserProfile';
export type { UserProfileSection } from './components/user-profile/model';
export { OrganizationSwitcher } from './components/OrganizationSwitcher';
export type { OrganizationSwitcherProps } from './components/OrganizationSwitcher';
export { OrganizationList } from './components/OrganizationList';
export type { OrganizationListProps } from './components/OrganizationList';
export { CreateOrganization } from './components/CreateOrganization';
export type { CreateOrganizationProps } from './components/CreateOrganization';
export { OrganizationProfile } from './components/OrganizationProfile';
export type { OrganizationProfileProps, OrganizationProfileSection } from './components/OrganizationProfile';
export { GoogleOneTap } from './components/GoogleOneTap';
export type {
  GoogleOneTapDismissReason,
  GoogleOneTapError,
  GoogleOneTapErrorCode,
  GoogleOneTapProps,
  GoogleOneTapSkipReason,
} from './components/GoogleOneTap';

// Re-export errors + the public-config type so consumers can `instanceof` /
// type against them without importing @authowl/core directly.
export { AuthOwlError, RateLimitedError, InvalidKeyError } from '@authowl/core';
export { membershipHas, membershipHasPermission, membershipHasTeam, createMembershipHas } from '@authowl/core';
export type {
  PublicConfig,
  AuthPasskey,
  ConsentStatus,
  HasParams,
  Organization,
  OrganizationDetails,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationMembership,
  OrganizationMemberWithUser,
  OrganizationRoleSummary,
  OrganizationTeam,
  OrganizationUserInvitation,
} from '@authowl/core';
