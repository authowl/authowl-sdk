import type { PublicConfig } from './public-config';

/** One compatibility boundary for project-controlled authentication UI. */
export type ProjectCapabilities = {
  emailSignUp: boolean;
  passwordSignUp: boolean;
  phoneSignUp: boolean;
  passwordSignIn: boolean;
  passwordMinLength: number;
  passwordMaxLength: number;
  magicLinkSignIn: boolean;
  emailOtpSignIn: boolean;
  phoneSignIn: boolean;
  usernameSignIn: boolean;
  collectUsername: boolean;
  passkeySignIn: boolean;
  passkeyAdd: boolean;
  firstLastName: boolean;
  emailChange: boolean;
  accountDeletion: boolean;
  emailVerificationRequired: boolean;
  emailVerificationMethod: 'link' | 'code';
  totp: boolean;
  mfaRequired: boolean;
  backupCodes: boolean;
  /** Preserve the pre-plan-35 display-name field only for an older server. */
  legacyNameField: boolean;
};

/**
 * Resolve current and legacy public-config shapes once, rather than spreading
 * compatibility checks through each platform's components.
 */
export function resolveProjectCapabilities(
  config: PublicConfig | null,
): ProjectCapabilities {
  const methods = config?.enabledMethods ?? ['password'];
  const legacyPassword = methods.includes('password');
  const legacyPasskey = methods.includes('passkey');
  const authentication = config?.authentication;
  const mfa = config?.mfa;

  return {
    emailSignUp:
      authentication?.email.signUp
      ?? methods.some((method) =>
        method === 'password' || method === 'magic_link' || method === 'email_otp'),
    passwordSignUp: authentication?.password.signUp ?? legacyPassword,
    phoneSignUp: authentication?.phone.signUp ?? methods.includes('phone_otp'),
    passwordSignIn: authentication?.email.signIn.includes('password') ?? legacyPassword,
    passwordMinLength: authentication?.password.minLength ?? 8,
    passwordMaxLength: authentication?.password.maxLength ?? 128,
    magicLinkSignIn:
      authentication?.email.signIn.includes('magic_link') ?? methods.includes('magic_link'),
    emailOtpSignIn:
      authentication?.email.signIn.includes('email_otp') ?? methods.includes('email_otp'),
    phoneSignIn: authentication?.phone.signIn ?? methods.includes('phone_otp'),
    usernameSignIn: authentication?.username.signIn ?? false,
    collectUsername: authentication?.username.collectOnSignUp ?? false,
    passkeySignIn: authentication?.passkey.signIn ?? legacyPasskey,
    passkeyAdd: authentication?.passkey.add ?? legacyPasskey,
    firstLastName: config?.userModel?.firstLastName ?? false,
    emailChange: config === null ? false : (config.userModel?.emailChange ?? true),
    accountDeletion:
      config?.userModel?.accountDeletion ?? config?.accountDeletion ?? false,
    emailVerificationRequired:
      config?.emailVerification?.required ?? config?.requireEmailVerification ?? false,
    emailVerificationMethod: config?.emailVerification?.method ?? 'link',
    totp: mfa?.totp ?? config?.twoFactor ?? false,
    mfaRequired: mfa?.required ?? config?.mfaRequired ?? false,
    backupCodes: mfa?.backupCodes ?? config?.twoFactor ?? false,
    legacyNameField: config?.authentication === undefined,
  };
}
