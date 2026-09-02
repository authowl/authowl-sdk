import type { PublicConfig } from '@authowl/core';

/**
 * Test-only PublicConfig factory (not exported from the package): one place to
 * absorb new server-contract fields instead of hand-editing a full literal in
 * every test file that needs a config.
 */
export function makePublicConfig(overrides: Partial<PublicConfig> = {}): PublicConfig {
  const enabledMethods = overrides.enabledMethods ?? [];
  return {
    applicationId: '11111111-1111-4111-8111-111111111111',
    environmentId: '22222222-2222-4222-8222-222222222222',
    environmentType: 'development',
    authBaseUrl:
      'https://auth.example.com/api/projects/22222222-2222-4222-8222-222222222222/auth',
    signUp: { mode: 'open' },
    authentication: {
      email: {
        signUp: enabledMethods.some((method) =>
          method === 'password' || method === 'magic_link' || method === 'email_otp'),
        signIn: enabledMethods.filter(
          (method): method is 'password' | 'magic_link' | 'email_otp' =>
            method === 'password' || method === 'magic_link' || method === 'email_otp',
        ),
      },
      phone: {
        signUp: enabledMethods.includes('phone_otp'),
        signIn: enabledMethods.includes('phone_otp'),
      },
      password: {
        signUp: enabledMethods.includes('password'),
        add: enabledMethods.includes('password'),
        minLength: 8,
        maxLength: 128,
      },
      passkey: {
        signIn: enabledMethods.includes('passkey'),
        add: enabledMethods.includes('passkey'),
      },
      username: { collectOnSignUp: false, signIn: false },
    },
    emailVerification: { required: false, method: 'link' },
    userModel: {
      requireEmail: false,
      firstLastName: false,
      emailChange: true,
      accountDeletion: false,
    },
    mfa: { totp: false, required: false, backupCodes: false },
    branding: {},
    enabledMethods,
    socialProviders: [],
    socialProviderClientIds: {},
    requireEmailVerification: false,
    legal: { version: 1, required: false },
    twoFactor: false,
    mfaRequired: false,
    accountDeletion: false,
    organizations: false,
    sso: false,
    jwtIssuer: null,
    captcha: null,
    turnstileSiteKey: null,
    authTurnstileSiteKey: null,
    locale: 'en',
    badge: true,
    configVersion: 1,
    ...overrides,
  };
}
