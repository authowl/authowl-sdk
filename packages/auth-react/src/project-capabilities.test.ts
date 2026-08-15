import { describe, expect, it } from 'vitest';
import { makePublicConfig } from './test-fixtures';
import { resolveProjectCapabilities } from './project-capabilities';

describe('resolveProjectCapabilities', () => {
  it('uses the nested lifecycle contract instead of conflating sign-in and add policy', () => {
    const config = makePublicConfig({
      enabledMethods: ['password', 'passkey'],
      authentication: {
        email: { signUp: false, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: false, add: false, minLength: 12, maxLength: 96 },
        passkey: { signIn: true, add: false },
        username: { collectOnSignUp: false, signIn: true },
      },
      emailVerification: { required: true, method: 'code' },
      userModel: {
        requireEmail: true,
        firstLastName: true,
        emailChange: false,
        accountDeletion: true,
      },
      mfa: { totp: true, required: true, backupCodes: true },
    });

    expect(resolveProjectCapabilities(config)).toEqual({
      emailSignUp: false,
      passwordSignUp: false,
      phoneSignUp: false,
      passwordSignIn: true,
      passwordMinLength: 12,
      passwordMaxLength: 96,
      magicLinkSignIn: false,
      emailOtpSignIn: false,
      phoneSignIn: false,
      usernameSignIn: true,
      collectUsername: false,
      passkeySignIn: true,
      passkeyAdd: false,
      firstLastName: true,
      emailChange: false,
      accountDeletion: true,
      emailVerificationRequired: true,
      emailVerificationMethod: 'code',
      totp: true,
      mfaRequired: true,
      backupCodes: true,
      legacyNameField: false,
    });
  });

  it('contains rolling compatibility for a pre-plan-35 server response', () => {
    const legacy = makePublicConfig({
      enabledMethods: ['password', 'passkey'],
      twoFactor: true,
      mfaRequired: false,
      accountDeletion: true,
    });
    delete legacy.authentication;
    delete legacy.emailVerification;
    delete legacy.userModel;
    delete legacy.mfa;

    expect(resolveProjectCapabilities(legacy)).toMatchObject({
      emailSignUp: true,
      passwordSignUp: true,
      passwordSignIn: true,
      passwordMinLength: 8,
      passwordMaxLength: 128,
      passkeySignIn: true,
      passkeyAdd: true,
      emailChange: true,
      accountDeletion: true,
      totp: true,
      backupCodes: true,
    });
  });

  it('fails closed for account mutations when config cannot be loaded', () => {
    expect(resolveProjectCapabilities(null)).toMatchObject({
      passwordSignIn: true,
      passwordMinLength: 8,
      passwordMaxLength: 128,
      passkeyAdd: false,
      emailChange: false,
      accountDeletion: false,
    });
  });
});
