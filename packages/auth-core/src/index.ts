export { decodePublishableKey, type DecodedPublishableKey } from './key-decode';
export { sessionCookieName } from './cookie';
export {
  resolveAuthTarget,
  resolveConfig,
  type AuthConfig,
  type ResolvedAuthConfig,
  type ResolvedAuthTarget,
} from './config';
export { sessionChallengeIsEphemeral } from './session-challenge';
export {
  captureInvitationClaim,
  clearInvitationClaim,
  INVITATION_CLAIM_MAX_AGE_MS,
  INVITATION_QUERY_PARAM,
  readInvitationClaim,
  type InvitationClaim,
} from './invitation-claim';
export {
  SESSION_TOKEN_HEADER,
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
} from './session-transport-contract';
export {
  resolveProjectCapabilities,
  type ProjectCapabilities,
} from './project-capabilities';
export {
  createAuthOwlClient,
  type AuthOwlClient,
  type AuthUser,
  type AuthSession,
  type AuthClientError,
  type AuthRequestContext,
  type AuthResponseContext,
  type AuthErrorContext,
  type AuthOwlErrorCode,
  type SessionState,
  type SessionStore,
  type AuthActionResult,
  type EmailAuthData,
  type EmailOtpAuthData,
  type TwoFactorRedirectData,
  type EmailSignUpData,
  type SocialAuthData,
  type SignOutData,
  type EmailSignInOptions,
  type UsernameSignInOptions,
  type EmailSignUpOptions,
  type WaitlistJoinOptions,
  type WaitlistJoinData,
  type SocialSignInOptions,
  type SocialIdTokenOptions,
  type ActionFetchOptions,
  type MagicLinkSignInOptions,
  type MagicLinkData,
  type EmailOtpType,
  type SendVerificationOtpOptions,
  type SendOtpData,
  type EmailOtpSignInOptions,
  type VerifyEmailOtpOptions,
  type VerifyEmailOtpData,
  type PhoneOtpStartOptions,
  type PhoneOtpStartData,
  type PhoneOtpChallengeData,
  type AkedlyShieldStartProof,
  type PhoneOtpVerifyOptions,
  type PhoneOtpVerifyData,
  type PhoneAuthUser,
  type RequestPasswordResetOptions,
  type ResetPasswordOptions,
  type PasswordResetData,
  type PasskeySignInOptions,
  type PasskeyAuthData,
  type AuthPasskey,
  type AddPasskeyOptions,
  type UpdatePasskeyOptions,
  type DeletePasskeyOptions,
  type DeletePasskeyData,
  type UpdatePasskeyData,
  type EnableTwoFactorOptions,
  type TwoFactorEnableData,
  type DisableTwoFactorOptions,
  type GenerateBackupCodesOptions,
  type TwoFactorBackupCodesData,
  type VerifyTotpOptions,
  type VerifyBackupCodeOptions,
  type SendTwoFactorOtpOptions,
  type SendTwoFactorOtpData,
  type VerifyTwoFactorOtpOptions,
  type TwoFactorVerifyData,
  type TwoFactorStatusData,
} from './client';
export { solvePhoneOtpChallenge } from './phone-otp-shield';
// The cross-site transport is an internal detail of `signIn.social`/`signIn.sso`
// and is deliberately NOT exported: nothing outside this package drives it, and
// exporting five functions would put a support surface under semver for no
// caller.
export type {
  AccountClient,
  AccountSession,
  AccountStatusData,
  ChangeEmailOptions,
  ChangePasswordData,
  ChangePasswordOptions,
  DeleteAccountData,
  DeleteAccountOptions,
  LinkSocialData,
  LinkSocialOptions,
  RevokeSessionOptions,
  SocialAccount,
  UnlinkSocialOptions,
  UpdateProfileOptions,
} from './account-client';
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  UpdateUnsafeMetadataOptions,
  UserMetadata,
} from './metadata-client';
export type {
  AcceptOrganizationInvitationData,
  CreateOrganizationOptions,
  DeleteOrganizationOptions,
  GetOrganizationInvitationOptions,
  GetOrganizationOptions,
  InviteOrganizationMemberOptions,
  LeaveOrganizationOptions,
  ListOrganizationInvitationsOptions,
  ListOrganizationMembersOptions,
  Organization,
  OrganizationClient,
  OrganizationDetails,
  OrganizationFilterOperator,
  OrganizationInvitation,
  OrganizationInvitationActionOptions,
  OrganizationInvitationDetails,
  OrganizationInvitationStatus,
  OrganizationMember,
  OrganizationMemberWithUser,
  OrganizationMembersData,
  OrganizationMemberUser,
  OrganizationSelector,
  OrganizationUserInvitation,
  ListOrganizationRolesOptions,
  OrganizationRoleSummary,
  RejectOrganizationInvitationData,
  RemoveOrganizationMemberData,
  RemoveOrganizationMemberOptions,
  SetActiveOrganizationOptions,
  SetActiveTeamOptions,
  OrganizationTeam,
  ListOrganizationTeamsOptions,
  UpdateOrganizationMemberRoleOptions,
  UpdateOrganizationOptions,
} from './organization-client';
export {
  membershipHas,
  membershipHasPermission,
  membershipHasRole,
  membershipHasTeam,
  createMembershipHas,
  type OrganizationMembership,
  type HasParams,
} from './organization-membership';
export {
  getPublicConfig,
  type EnvironmentType,
  type PublicConfig,
} from './public-config';
export { createIdempotencyKey } from './idempotency';
export { AUTH_CHALLENGE_HEADER } from './http-client';
export { createTokenClient, type TokenClient, type GetToken, type GetTokenOptions } from './token';
export {
  getConsentStatus,
  acceptConsent,
  type ConsentStatus,
  type ConsentAcceptResult,
} from './consent';
export { AuthOwlError, RateLimitedError, InvalidKeyError } from './errors';
export { AuthOwlHttpError } from './http';
export { TransportError, type TransportErrorKind } from './transport';
export { LOCALES, directionFor, isLocale, type Locale } from './i18n';
