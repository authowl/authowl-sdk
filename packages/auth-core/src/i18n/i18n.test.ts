import { describe, expect, it } from 'vitest';
import type { AuthOwlErrorCode } from '../client';
import {
  catalogs,
  formatMessage,
  formatRetryDuration,
  resolveServerError,
  serverErrorMessage,
  type MessageKey,
} from './catalog';
import { en } from './en';
import { ar } from './ar';

describe('catalogs', () => {
  const locales = Object.keys(catalogs) as (keyof typeof catalogs)[];

  it('every locale has exactly the en key set (parity)', () => {
    const enKeys = Object.keys(en).sort();
    for (const locale of locales) {
      expect(Object.keys(catalogs[locale]).sort(), locale).toEqual(enKeys);
    }
  });

  it('no catalog entry is empty and ar is actually translated', () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
    // Sanity: the Arabic catalog isn't a copy of English (brand/technical
    // tokens like "QR" may match; the vast majority must differ).
    const identical = Object.keys(en).filter(
      (k) => en[k as MessageKey] === ar[k as MessageKey],
    );
    expect(identical.length).toBeLessThan(Object.keys(en).length * 0.05);
  });

  it('interpolation params match across locales (a translation cannot drop a {param})', () => {
    const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(params(ar[key]), key).toEqual(params(en[key]));
    }
  });
});

describe('formatMessage', () => {
  it('substitutes {params} and leaves unknown tokens visible', () => {
    expect(formatMessage('en', 'social.continueWith', { provider: 'Google' })).toBe(
      'Continue with Google',
    );
    expect(formatMessage('en', 'social.continueWith', {})).toBe('Continue with {provider}');
    expect(formatMessage('ar', 'emailOtp.codeLabel', { email: 'a@b.co' })).toContain('a@b.co');
  });
});


describe('serverErrorMessage', () => {
  it('maps known server codes per locale and returns null for unknown', () => {
    const mauBudgetCode: AuthOwlErrorCode = 'MAU_BUDGET_REACHED';
    const recoveryDisabledCode: AuthOwlErrorCode = 'EMAIL_OTP_RECOVERY_DISABLED';

    expect(serverErrorMessage('en', 'INVALID_EMAIL_OR_PASSWORD')).toBe(
      'Incorrect email or password.',
    );
    expect(serverErrorMessage('ar', 'MAU_LIMIT_REACHED')).toBe(
      catalogs.ar['serverError.MAU_LIMIT_REACHED'],
    );
    expect(serverErrorMessage('en', mauBudgetCode)).toBe(
      'Sign-ups are temporarily paused for this application. Please try again later.',
    );
    expect(serverErrorMessage('ar', mauBudgetCode)).toBe(
      catalogs.ar['serverError.MAU_BUDGET_REACHED'],
    );
    expect(serverErrorMessage('en', recoveryDisabledCode)).toBe(
      catalogs.en['serverError.EMAIL_OTP_RECOVERY_DISABLED'],
    );
    expect(serverErrorMessage('en', 'PASSKEY_PAGE_NOT_FOCUSED')).toBe(
      catalogs.en['serverError.PASSKEY_PAGE_NOT_FOCUSED'],
    );
    expect(serverErrorMessage('ar', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')).toBe(
      catalogs.ar['serverError.ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'],
    );
    expect(serverErrorMessage('en', 'SOME_FUTURE_CODE')).toBeNull();
    expect(serverErrorMessage('en', undefined)).toBeNull();
  });
});

describe('resolveServerError', () => {
  const generic = 'Sign up failed';
  const NEWLY_MAPPED = [
    'PASSWORD_COMPROMISED',
    'PASSWORD_TOO_SHORT',
    'PASSWORD_TOO_LONG',
    'INVALID_EMAIL',
    'BANNED_USER',
    'PASSWORD_RESET_REQUIRED',
    'PASSWORD_SIGNUP_REQUIRED',
    'SSO_EMAIL_DOMAIN_MISMATCH',
    'MFA_ENROLLMENT_REQUIRED',
    'EMAIL_OTP_RECOVERY_DISABLED',
    'TOO_MANY_ATTEMPTS',
    'ACCOUNT_TEMPORARILY_LOCKED',
  ] as const;

  it('renders each newly-mapped code from the catalog (en + ar)', () => {
    for (const code of NEWLY_MAPPED) {
      const key = `serverError.${code}` as MessageKey;
      // A server `message` is present but a mapped code must win over it.
      const error = { code, status: 400, message: 'raw server text' };
      expect(resolveServerError('en', error, generic), code).toBe(catalogs.en[key]);
      expect(resolveServerError('ar', error, generic), code).toBe(catalogs.ar[key]);
    }
  });

  // P1-2: terse 2FA/OTP + ORGANIZATION_* codes carry a short ENGLISH server
  // `message` (e.g. "Invalid code", "Invalid OTP", "Organization slug already
  // taken"). Before mapping, the server-message fallback rendered that English
  // string and SHADOWED the component's own localized copy, so an Arabic user
  // saw English on 2FA/OTP/org failures. Each must now render its catalog copy
  // in BOTH locales - i.e. NOT the English server message - with the real
  // engine status codes (401 for wrong TOTP, 400 for OTP, 403 for org perms).
  const TERSE_CODES: Array<[string, number, string]> = [
    // [code, engine status, the English message the server actually sends]
    ['INVALID_CODE', 401, 'Invalid code'],
    ['INVALID_BACKUP_CODE', 401, 'Invalid backup code'],
    ['INVALID_OTP', 400, 'Invalid OTP'],
    ['OTP_EXPIRED', 400, 'OTP expired'],
    ['OTP_HAS_EXPIRED', 400, 'OTP has expired'],
    ['TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 400, 'Too many attempts. Please request a new code.'],
    ['INVALID_TWO_FACTOR_COOKIE', 401, 'Invalid two factor cookie'],
    ['ORGANIZATION_SLUG_ALREADY_TAKEN', 400, 'Organization slug already taken'],
    ['ORGANIZATION_ALREADY_EXISTS', 400, 'Organization already exists'],
    ['YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS', 403, 'You have reached the maximum number of organizations'],
    ['ORGANIZATION_NOT_FOUND', 400, 'Organization not found'],
    ['USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION', 401, 'User is not a member of the organization'],
    ['NO_ACTIVE_ORGANIZATION', 400, 'No active organization'],
    ['ORGANIZATION_MEMBERSHIP_LIMIT_REACHED', 403, 'Organization membership limit reached'],
    ['MEMBER_NOT_FOUND', 400, 'Member not found'],
    ['INVITATION_NOT_FOUND', 400, 'Invitation not found'],
    ['YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', 403, 'You are not the recipient of the invitation'],
    ['EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION', 403, 'Email verification required to view or list invitations for the session email'],
    ['EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION', 403, 'Email verification required before accepting or rejecting invitation'],
    ['USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', 400, 'User is already a member of this organization'],
    ['USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION', 400, 'User is already invited to this organization'],
    ['YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION', 403, 'You are not allowed to invite users to this organization'],
    ['YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE', 403, 'You are not allowed to invite a user with this role'],
    ['YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER', 400, 'You cannot leave the organization as the only owner'],
    ['YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER', 400, 'You cannot leave the organization without an owner'],
    ['YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION', 403, 'You are not allowed to update this organization'],
    ['YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION', 403, 'You are not allowed to delete this organization'],
    ['YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER', 403, 'You are not allowed to delete this member'],
    ['YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER', 403, 'You are not allowed to update this member'],
    ['YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION', 403, 'You are not allowed to cancel this invitation'],
    // Privacy rights intake preconditions. The server writes these for an end
    // user, so an unmapped code looks fine in English and shows English to
    // every Arabic reader.
    ['RIGHTS_INTAKE_UNAVAILABLE', 409, 'This app is not accepting data rights requests yet.'],
    ['RIGHT_NOT_CONFIGURED', 409, 'This right is not configured for every data source.'],
    // Plan 43.3's step-up gate. The server's own sentence is written for an end
    // user, so an unmapped code would have LOOKED fine in English while showing
    // English to every Arabic reader.
    [
      'SECOND_FACTOR_REQUIRED',
      403,
      'Enter a code from your authenticator app, or one of your backup codes, before changing two-factor authentication.',
    ],
  ];

  it('localizes each terse 2FA/OTP/org code instead of shadowing with the English server message', () => {
    const localizedGeneric = 'تعذر إكمال العملية';
    for (const [code, status, serverMessage] of TERSE_CODES) {
      const key = `serverError.${code}` as MessageKey;
      // Sanity: both locales actually carry the key (compile-time parity, but
      // assert at runtime so a typo in the code string is caught here).
      expect(key in catalogs.en, `${code} en`).toBe(true);
      expect(key in catalogs.ar, `${code} ar`).toBe(true);
      const error = { code, status, message: serverMessage };
      // en: the curated catalog copy, NOT the raw server string.
      expect(resolveServerError('en', error, generic), `${code} en`).toBe(catalogs.en[key]);
      // ar: Arabic catalog copy, and definitively NOT the English server message.
      const arResolved = resolveServerError('ar', error, localizedGeneric);
      expect(arResolved, `${code} ar`).toBe(catalogs.ar[key]);
      expect(arResolved, `${code} ar not english`).not.toBe(serverMessage);
    }
  });

  it('reuses the server wording verbatim for PASSWORD_COMPROMISED (en)', () => {
    expect(resolveServerError('en', { code: 'PASSWORD_COMPROMISED', status: 400 }, generic)).toBe(
      'This password has appeared in a known data breach. Please choose a different one.',
    );
  });

  it('shows the server message for an unmapped 4xx code that carries one', () => {
    expect(
      resolveServerError(
        'en',
        { code: 'FAILED_TO_CREATE_USER', status: 400, message: 'Could not create your account right now.' },
        generic,
      ),
    ).toBe('Could not create your account right now.');
    // Also works with no code at all, as long as a real 4xx message is present.
    expect(
      resolveServerError('en', { status: 422, message: 'That value is not allowed.' }, generic),
    ).toBe('That value is not allowed.');
  });

  it('falls back to generic when there is no real server message', () => {
    // No message.
    expect(resolveServerError('en', { code: 'WEIRD_CODE', status: 400 }, generic)).toBe(generic);
    // Synthesized statusText filler (message === statusText).
    expect(
      resolveServerError(
        'en',
        { code: 'WEIRD_CODE', status: 400, statusText: 'Bad Request', message: 'Bad Request' },
        generic,
      ),
    ).toBe(generic);
    // core's "Request failed" filler.
    expect(
      resolveServerError('en', { code: 'WEIRD_CODE', status: 400, message: 'Request failed' }, generic),
    ).toBe(generic);
    // 5xx internal body strings stay generic.
    expect(
      resolveServerError('en', { code: 'WEIRD_CODE', status: 500, message: 'NullPointer at line 12' }, generic),
    ).toBe(generic);
    // Over-long blob is dropped.
    expect(
      resolveServerError('en', { code: 'WEIRD_CODE', status: 400, message: 'x'.repeat(201) }, generic),
    ).toBe(generic);
  });

  it('does not leak enumeration-sensitive codes via the message fallback', () => {
    for (const code of [
      'USER_NOT_FOUND',
      'USER_EMAIL_NOT_FOUND',
      'ACCOUNT_NOT_FOUND',
      'CREDENTIAL_ACCOUNT_NOT_FOUND',
    ]) {
      expect(
        resolveServerError('en', { code, status: 404, message: 'No account for that email.' }, generic),
        code,
      ).toBe(generic);
    }
  });

  it('keeps USER_ALREADY_EXISTS mapped and a mapped code beats a server message', () => {
    expect(resolveServerError('en', { code: 'USER_ALREADY_EXISTS', status: 400 }, generic)).toBe(
      catalogs.en['serverError.USER_ALREADY_EXISTS'],
    );
    expect(
      resolveServerError(
        'en',
        { code: 'INVALID_EMAIL', status: 400, message: 'totally different server text' },
        generic,
      ),
    ).toBe(catalogs.en['serverError.INVALID_EMAIL']);
  });

  it('maps a bare 429 (no code) to RATE_LIMITED in both locales', () => {
    expect(resolveServerError('en', { status: 429 }, generic)).toBe(
      catalogs.en['serverError.RATE_LIMITED'],
    );
    expect(resolveServerError('ar', { status: 429 }, generic)).toBe(
      catalogs.ar['serverError.RATE_LIMITED'],
    );
  });

  it('renders a dynamic retry duration in minutes (en) and Arabic plural forms', () => {
    expect(
      resolveServerError(
        'en',
        { code: 'ACCOUNT_TEMPORARILY_LOCKED', status: 403, retryAfterSeconds: 300 },
        generic,
      ),
    ).toContain('Try again in 5 minutes');
    // A bare-429-derived RATE_LIMITED still gets the duration.
    expect(resolveServerError('en', { status: 429, retryAfterSeconds: 30 }, generic)).toContain(
      'Try again in 30 seconds',
    );
    // Arabic uses Intl's native plural/dual forms (5 -> دقائق), not the static copy.
    const ar300 = resolveServerError(
      'ar',
      { code: 'TOO_MANY_ATTEMPTS', status: 429, retryAfterSeconds: 300 },
      generic,
    );
    expect(ar300).toContain(formatRetryDuration('ar', 300));
    expect(ar300).not.toBe(catalogs.ar['serverError.TOO_MANY_ATTEMPTS']);
  });

  it('falls back to the static retry copy when no duration is present', () => {
    expect(resolveServerError('en', { code: 'TOO_MANY_ATTEMPTS', status: 429 }, generic)).toBe(
      catalogs.en['serverError.TOO_MANY_ATTEMPTS'],
    );
  });

  it('returns the caller fallback for a null/undefined error', () => {
    expect(resolveServerError('en', null, generic)).toBe(generic);
    expect(resolveServerError('en', undefined, generic)).toBe(generic);
  });
});

describe('formatRetryDuration', () => {
  it('rounds >= 90s up to whole minutes and otherwise renders seconds', () => {
    expect(formatRetryDuration('en', 300)).toBe('5 minutes');
    expect(formatRetryDuration('en', 91)).toBe('2 minutes');
    expect(formatRetryDuration('en', 89)).toBe('89 seconds');
    expect(formatRetryDuration('en', 1)).toBe('1 second');
    // Clamps a nonsensical value up to at least one second.
    expect(formatRetryDuration('en', 0)).toBe('1 second');
  });
});
