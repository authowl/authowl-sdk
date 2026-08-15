import { describe, it, expect } from 'vitest';
import type { PublicConfig } from '@authowl/core';
import { resolveSignInMethods, emailAutocomplete } from './signin-methods';
import { makePublicConfig } from './test-fixtures';

/** Build a PublicConfig with the fields the resolver reads, defaults for the rest. */
function cfg(partial: Partial<PublicConfig>): PublicConfig {
  return makePublicConfig(partial);
}

describe('resolveSignInMethods', () => {
  it('falls back to password when config is unavailable (null)', () => {
    const plan = resolveSignInMethods(null);
    expect(plan.password).toBe(true);
    expect(plan.magicLink).toBe(false);
    expect(plan.passkey).toBe(false);
    expect(plan.renderable).toBe(true);
    expect(plan.emptyReason).toBeNull();
  });

  it('renders each enabled passwordless method independently', () => {
    expect(resolveSignInMethods(cfg({ enabledMethods: ['magic_link'] }))).toMatchObject({
      password: false,
      magicLink: true,
      emailOtp: false,
      passkey: false,
      renderable: true,
    });
    expect(resolveSignInMethods(cfg({ enabledMethods: ['email_otp'] })).emailOtp).toBe(true);
    expect(resolveSignInMethods(cfg({ enabledMethods: ['passkey'] })).passkey).toBe(true);
  });

  it('is renderable on social providers alone (no email methods)', () => {
    const plan = resolveSignInMethods(cfg({ enabledMethods: [], socialProviders: ['google'] }));
    expect(plan.renderable).toBe(true);
    expect(plan.social).toEqual(['google']);
    expect(plan.emptyReason).toBeNull();
  });

  it('surfaces every enabled surface together', () => {
    const plan = resolveSignInMethods(
      cfg({ enabledMethods: ['password', 'magic_link', 'email_otp', 'passkey'], socialProviders: ['github'] }),
    );
    expect(plan).toMatchObject({
      password: true,
      magicLink: true,
      emailOtp: true,
      passkey: true,
      social: ['github'],
      renderable: true,
      emptyReason: null,
    });
  });

  it('hides email-code sign-in when MFA is enabled because it cannot complete the password-gated flow', () => {
    const plan = resolveSignInMethods(cfg({
      enabledMethods: ['password', 'email_otp'],
      twoFactor: true,
      mfaRequired: true,
      mfa: { totp: true, required: true, backupCodes: true },
    }));

    expect(plan.password).toBe(true);
    expect(plan.emailOtp).toBe(false);
    expect(plan.primary).toBe('password');
    expect(plan.renderable).toBe(true);
  });

  it('keeps email-code sign-in available when MFA is disabled', () => {
    const plan = resolveSignInMethods(cfg({
      enabledMethods: ['email_otp'],
      twoFactor: false,
      mfaRequired: false,
      mfa: { totp: false, required: false, backupCodes: false },
    }));

    expect(plan.emailOtp).toBe(true);
    expect(plan.primary).toBe('otp');
  });

  it('reports "unsupported" when only unknown (future) methods are enabled', () => {
    const plan = resolveSignInMethods(cfg({ enabledMethods: ['sms', 'web3'] }));
    expect(plan.renderable).toBe(false);
    expect(plan.emptyReason).toBe('unsupported');
  });

  it('reports "none" when nothing at all is enabled', () => {
    const plan = resolveSignInMethods(cfg({ enabledMethods: [], socialProviders: [] }));
    expect(plan.renderable).toBe(false);
    expect(plan.emptyReason).toBe('none');
  });

  it('renders known methods even when unknown ones are mixed in', () => {
    const plan = resolveSignInMethods(cfg({ enabledMethods: ['password', 'sms'] }));
    expect(plan.password).toBe(true);
    expect(plan.renderable).toBe(true);
    expect(plan.emptyReason).toBeNull();
  });

  it('renders phone_otp as a first-class method without making it the email submit action', () => {
    const plan = resolveSignInMethods(cfg({ enabledMethods: ['phone_otp'] }));
    expect(plan.phoneOtp).toBe(true);
    expect(plan.renderable).toBe(true);
    expect(plan.primary).toBeNull();
    expect(plan.emptyReason).toBeNull();
  });

  it('hides phone sign-in when MFA is required for every account', () => {
    const plan = resolveSignInMethods(cfg({
      enabledMethods: ['password', 'phone_otp'],
      twoFactor: true,
      mfaRequired: true,
      mfa: { totp: true, required: true, backupCodes: true },
    }));

    expect(plan.password).toBe(true);
    expect(plan.phoneOtp).toBe(false);
    expect(plan.primary).toBe('password');
  });

  it('keeps phone sign-in for phone-only users when MFA enrollment is optional', () => {
    const plan = resolveSignInMethods(cfg({
      enabledMethods: ['password', 'phone_otp'],
      twoFactor: true,
      mfaRequired: false,
      mfa: { totp: true, required: false, backupCodes: true },
    }));

    expect(plan.phoneOtp).toBe(true);
  });

  it('renders username sign-in independently from the legacy method list', () => {
    const config = cfg({ enabledMethods: ['password'] });
    config.authentication!.username.signIn = true;
    const plan = resolveSignInMethods(config);
    expect(plan.username).toBe(true);
    expect(plan.password).toBe(true);
    expect(plan.renderable).toBe(true);
  });

  it('renders SSO as an email method: primary when alone, renderable, not empty', () => {
    const plan = resolveSignInMethods(cfg({ enabledMethods: ['sso'] }));
    expect(plan.sso).toBe(true);
    expect(plan.renderable).toBe(true);
    expect(plan.primary).toBe('sso');
    expect(plan.emptyReason).toBeNull();
  });

  describe('primary (the filled submit action)', () => {
    it('is null with no email method (social/passkey only)', () => {
      expect(resolveSignInMethods(cfg({ enabledMethods: ['passkey'], socialProviders: ['google'] })).primary).toBeNull();
    });
    it('prefers password, then magic-link, then email-OTP, then SSO', () => {
      expect(resolveSignInMethods(cfg({ enabledMethods: ['password', 'magic_link', 'email_otp'] })).primary).toBe('password');
      expect(resolveSignInMethods(cfg({ enabledMethods: ['magic_link', 'email_otp'] })).primary).toBe('magic');
      expect(resolveSignInMethods(cfg({ enabledMethods: ['email_otp'] })).primary).toBe('otp');
      expect(resolveSignInMethods(cfg({ enabledMethods: ['email_otp', 'sso'] })).primary).toBe('otp');
      expect(resolveSignInMethods(cfg({ enabledMethods: ['sso'] })).primary).toBe('sso');
    });
    it('keeps SSO a non-primary alternate when password is also enabled', () => {
      const plan = resolveSignInMethods(cfg({ enabledMethods: ['password', 'sso'] }));
      expect(plan.primary).toBe('password');
      expect(plan.sso).toBe(true);
    });
    it('drives autofillHost (same first email method) when passkey is on', () => {
      const plan = resolveSignInMethods(cfg({ enabledMethods: ['magic_link', 'email_otp', 'passkey'] }));
      expect(plan.primary).toBe('magic');
      expect(plan.autofillHost).toBe('magic_link');
    });
  });

  describe('autofillHost (passkey conditional-mediation target)', () => {
    it('is null when passkey is not enabled', () => {
      expect(resolveSignInMethods(cfg({ enabledMethods: ['password', 'magic_link'] })).autofillHost).toBeNull();
    });

    it('is null when passkey is enabled but no email method hosts it', () => {
      expect(resolveSignInMethods(cfg({ enabledMethods: ['passkey'] })).autofillHost).toBeNull();
      expect(
        resolveSignInMethods(cfg({ enabledMethods: ['passkey'], socialProviders: ['google'] })).autofillHost,
      ).toBeNull();
    });

    it('picks the first email method in render-priority order (password > magic_link > email_otp)', () => {
      expect(
        resolveSignInMethods(cfg({ enabledMethods: ['password', 'magic_link', 'email_otp', 'passkey'] }))
          .autofillHost,
      ).toBe('password');
      expect(
        resolveSignInMethods(cfg({ enabledMethods: ['magic_link', 'email_otp', 'passkey'] })).autofillHost,
      ).toBe('magic_link');
      expect(
        resolveSignInMethods(cfg({ enabledMethods: ['email_otp', 'passkey'] })).autofillHost,
      ).toBe('email_otp');
    });

    it('arms the shared email input for an SSO-primary project with passkey on', () => {
      const plan = resolveSignInMethods(cfg({ enabledMethods: ['sso', 'passkey'] }));
      expect(plan.primary).toBe('sso');
      expect(plan.autofillHost).toBe('sso');
    });
  });
});

describe('emailAutocomplete', () => {
  it('adds the webauthn token only for the passkey host input', () => {
    expect(emailAutocomplete(true)).toBe('email webauthn');
    expect(emailAutocomplete(false)).toBe('email');
  });
});

describe('passkey reachability', () => {
  // A shared-host project: the engine's RP id is the auth host, which is not a
  // registrable suffix of the app's host, so no browser can complete it.
  it('hides passkey when the auth host cannot be the page\'s RP id', () => {
    const plan = resolveSignInMethods(
      cfg({
        enabledMethods: ['password', 'passkey'],
        authBaseUrl: 'https://authowl.dev/api/projects/p/auth',
      }),
      'localhost',
    );
    expect(plan.passkey).toBe(false);
    // The autofill host hangs off the same decision, so it must go too -
    // arming conditional mediation for an impossible ceremony is the same bug.
    expect(plan.autofillHost).toBeNull();
    expect(plan.password).toBe(true);
  });

  it('keeps passkey when the page is the auth host', () => {
    expect(
      resolveSignInMethods(
        cfg({ enabledMethods: ['passkey'], authBaseUrl: 'https://acme.com/api/projects/p/auth' }),
        'acme.com',
      ).passkey,
    ).toBe(true);
  });

  it('keeps passkey on a subdomain of the auth host', () => {
    expect(
      resolveSignInMethods(
        cfg({ enabledMethods: ['passkey'], authBaseUrl: 'https://acme.com/api/projects/p/auth' }),
        'app.acme.com',
      ).passkey,
    ).toBe(true);
  });

  it('does not hide passkey when the page host is unknown (server render)', () => {
    expect(
      resolveSignInMethods(
        cfg({ enabledMethods: ['passkey'], authBaseUrl: 'https://authowl.dev/api/projects/p/auth' }),
      ).passkey,
    ).toBe(true);
  });
});

describe('passkey reachability from the published relying-party id', () => {
  const withRp = (relyingPartyId: string | null | undefined) =>
    cfg({
      enabledMethods: ['password', 'passkey'],
      authBaseUrl: 'https://authowl.dev/api/projects/p/auth',
      authentication: {
        email: { signUp: true, signIn: ['password'] },
        phone: { signUp: false, signIn: false },
        password: { signUp: true, add: true },
        passkey: { signIn: true, add: true, relyingPartyId },
        username: { collectOnSignUp: false, signIn: false },
      },
    } as never);

  // The whole point of publishing the id: the app is cross-host from the API,
  // which used to mean "hide it", and now means "offer it" because the server
  // binds credentials to the app's own domain.
  it('offers passkey on the tenant domain once the server names it', () => {
    expect(resolveSignInMethods(withRp('acme.com'), 'app.acme.com').passkey).toBe(true);
  });

  it('still hides it on a page the named id cannot cover', () => {
    expect(resolveSignInMethods(withRp('acme.com'), 'localhost').passkey).toBe(false);
  });

  // Absent means an older server, which derives the id from the auth host - so
  // the old behaviour has to survive exactly, or upgrading the SDK against a
  // not-yet-deployed server would hide working passkeys.
  it('falls back to the auth host when the server publishes nothing', () => {
    expect(resolveSignInMethods(withRp(undefined), 'localhost').passkey).toBe(false);
    expect(resolveSignInMethods(withRp(undefined), 'authowl.dev').passkey).toBe(true);
  });

  it('treats an explicit null the same as absent', () => {
    expect(resolveSignInMethods(withRp(null), 'authowl.dev').passkey).toBe(true);
  });

  it('supports a localhost id for development', () => {
    expect(resolveSignInMethods(withRp('localhost'), 'localhost').passkey).toBe(true);
  });
});
