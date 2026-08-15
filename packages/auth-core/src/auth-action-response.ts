import type {
  EmailAuthData,
  EmailOtpAuthData,
  EmailSignUpData,
  MagicLinkData,
  PasswordResetData,
  PhoneAuthUser,
  PhoneOtpStartData,
  PhoneOtpChallengeData,
  PhoneOtpVerifyData,
  SendOtpData,
  SendTwoFactorOtpData,
  SignOutData,
  SocialAuthData,
  SsoAuthData,
  TwoFactorBackupCodesData,
  TwoFactorEnableData,
  TwoFactorRedirectData,
  TwoFactorStatusData,
  TwoFactorVerifyData,
  VerificationEmailData,
  VerifyEmailOtpData,
} from './client';
import {
  asBoolean,
  asDate,
  asRecord,
  asString,
  decodeAuthUser,
  invalidResponse,
  optionalNullableString,
} from './response-schema';

const MAX_REDIRECT_URL_LENGTH = 4_096;
const MAX_TOTP_URI_LENGTH = 4_096;
const MAX_BACKUP_CODES = 100;
const MAX_BACKUP_CODE_LENGTH = 256;
const MAX_FACTOR_METHODS = 16;
const MAX_FACTOR_METHOD_LENGTH = 64;

/**
 * Ceiling on the Akedly Shield proof-of-work difficulty this client will
 * attempt. Mirrors the bound the server applies when it reads the provider's
 * challenge (`lib/messaging/providers/akedly-shield.ts`); keep the two in step.
 */
export const MAX_PROOF_OF_WORK_DIFFICULTY = 12;

export function decodeEmailSignIn(
  value: unknown,
): EmailAuthData | TwoFactorRedirectData {
  const row = asRecord(value);
  if (row.twoFactorRedirect === true) {
    if (
      row.user !== undefined
      || row.redirect !== undefined
      || row.url !== undefined
    ) {
      invalidResponse();
    }
    return {
      twoFactorRedirect: true,
      ...(row.twoFactorMethods === undefined
        ? {}
        : {
            twoFactorMethods: decodeUniqueStrings(
              row.twoFactorMethods,
              MAX_FACTOR_METHODS,
              MAX_FACTOR_METHOD_LENGTH,
            ),
          }),
    };
  }
  if (row.twoFactorRedirect !== undefined) invalidResponse();

  return {
    redirect: asBoolean(row.redirect),
    ...decodeOptionalString(row, 'url'),
    user: decodeAuthUser(row.user),
  };
}

export function decodeEmailOtpSignIn(value: unknown): EmailOtpAuthData {
  const row = asRecord(value);
  return {
    user: decodeAuthUser(row.user),
  };
}

export function decodeEmailSignUp(value: unknown): EmailSignUpData {
  const row = asRecord(value);
  return {
    sessionCreated: asBoolean(row.sessionCreated),
    user: decodeAuthUser(row.user),
  };
}

export function decodeSocialSignIn(
  value: unknown,
  allowHttpLoopback: boolean,
): SocialAuthData {
  const row = asRecord(value);
  const redirect = asBoolean(row.redirect);
  if (row.user === null) invalidResponse();
  const hasUser = row.user !== undefined && row.user !== null;
  const hasUrl = row.url !== undefined && row.url !== null;

  if (redirect) {
    if (hasUser || !hasUrl) invalidResponse();
    return {
      redirect: true,
      url: decodeNavigationUrl(row.url, allowHttpLoopback),
    };
  }
  if (hasUser === hasUrl) invalidResponse();
  if (hasUser) {
    return {
      redirect: false,
      user: decodeAuthUser(row.user),
    };
  }
  return {
    redirect: false,
    url: decodeNavigationUrl(row.url, allowHttpLoopback),
  };
}

export function decodeSsoSignIn(
  value: unknown,
  allowHttpLoopback: boolean,
): SsoAuthData {
  const row = asRecord(value);
  if (row.redirect !== true || row.user !== undefined) invalidResponse();
  return {
    redirect: true,
    url: decodeNavigationUrl(row.url, allowHttpLoopback),
  };
}

export function decodeMagicLink(value: unknown): MagicLinkData {
  return { status: asBoolean(asRecord(value).status) };
}

export function decodeSendOtp(value: unknown): SendOtpData {
  return { success: asBoolean(asRecord(value).success) };
}

export function decodePhoneOtpStart(value: unknown): PhoneOtpStartData {
  if (asRecord(value).status !== 'pending') invalidResponse();
  return { status: 'pending' };
}

export function decodePhoneOtpChallenge(value: unknown): PhoneOtpChallengeData {
  const row = asRecord(value);
  if (row.kind === 'authowl_turnstile') return { kind: 'authowl_turnstile' };
  if (row.kind !== 'akedly_shield_v1_2') invalidResponse();
  const turnstile = asRecord(row.turnstile);
  const siteKey = turnstile.siteKey === null ? null : asString(turnstile.siteKey);
  return {
    kind: 'akedly_shield_v1_2',
    connectionId: asString(row.connectionId),
    challenge: asString(row.challenge),
    difficulty: asProofOfWorkDifficulty(row.difficulty),
    challengeToken: asString(row.challengeToken),
    challengeRequired: asBoolean(row.challengeRequired),
    turnstile: { required: asBoolean(turnstile.required), siteKey },
  };
}

/**
 * The proof-of-work difficulty, bounded at the same ceiling the server applies
 * when it reads Akedly's challenge.
 *
 * The bound is re-applied HERE rather than inherited: the SDK solves this proof
 * synchronously on the browser's main thread, and it points at whatever
 * `apiUrl` the application configured. An unbounded difficulty from a
 * misconfigured, rolled-back, or hostile endpoint would hang the tab with no
 * way out, so the client refuses the challenge instead of attempting it.
 */
function asProofOfWorkDifficulty(value: unknown): number {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > MAX_PROOF_OF_WORK_DIFFICULTY
  ) invalidResponse();
  return Number(value);
}

export function decodePhoneOtpVerify(value: unknown): PhoneOtpVerifyData {
  const row = asRecord(value);
  if (row.status !== true || row.sessionCreated !== true) invalidResponse();
  return {
    status: true,
    sessionCreated: true,
    user: decodePhoneAuthUser(row.user),
  };
}

export function decodePasswordReset(value: unknown): PasswordResetData {
  return { status: asBoolean(asRecord(value).status) };
}

export function decodeVerificationEmail(value: unknown): VerificationEmailData {
  return { status: asBoolean(asRecord(value).status) };
}

export function decodeVerifyEmailOtp(value: unknown): VerifyEmailOtpData {
  const row = asRecord(value);
  return {
    status: asBoolean(row.status),
    user: decodeAuthUser(row.user),
  };
}

export function decodeSignOut(value: unknown): SignOutData {
  return { success: asBoolean(asRecord(value).success) };
}

export function decodeTwoFactorEnable(value: unknown): TwoFactorEnableData {
  const row = asRecord(value);
  return {
    totpURI: decodeTotpUri(row.totpURI),
    backupCodes: decodeBackupCodes(row.backupCodes),
  };
}

export function decodeTwoFactorStatus(value: unknown): TwoFactorStatusData {
  return { status: asBoolean(asRecord(value).status) };
}

export function decodeTwoFactorVerify(value: unknown): TwoFactorVerifyData {
  if (asRecord(value).status !== true) invalidResponse();
  return { status: true };
}

export function decodeSendTwoFactorOtp(
  value: unknown,
): SendTwoFactorOtpData {
  return { status: asBoolean(asRecord(value).status) };
}

export function decodeTwoFactorBackupCodes(
  value: unknown,
): TwoFactorBackupCodesData {
  const row = asRecord(value);
  if (row.status !== undefined && row.status !== true) invalidResponse();
  return { backupCodes: decodeBackupCodes(row.backupCodes) };
}

function decodePhoneAuthUser(value: unknown): PhoneAuthUser {
  const row = asRecord(value);
  return {
    id: nonEmptyString(row.id, 512),
    ...decodeOptionalNullableString(row, 'name', 1_024),
    phoneNumber: nonEmptyString(row.phoneNumber, 64),
    phoneNumberVerified: asBoolean(row.phoneNumberVerified),
    ...(row.createdAt === undefined ? {} : { createdAt: asDate(row.createdAt) }),
    ...(row.updatedAt === undefined ? {} : { updatedAt: asDate(row.updatedAt) }),
  };
}

function decodeNavigationUrl(
  value: unknown,
  allowHttpLoopback: boolean,
): string {
  const raw = nonEmptyString(value, MAX_REDIRECT_URL_LENGTH);
  if (/[\u0000-\u0020\u007f]/u.test(raw)) invalidResponse();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalidResponse();
  }
  if (parsed.username || parsed.password) invalidResponse();
  if (parsed.protocol === 'https:') return parsed.href;
  if (
    allowHttpLoopback
    && parsed.protocol === 'http:'
    && isLoopbackHostname(parsed.hostname)
  ) {
    return parsed.href;
  }
  return invalidResponse();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
  );
}

function decodeTotpUri(value: unknown): string {
  const raw = nonEmptyString(value, MAX_TOTP_URI_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalidResponse();
  }
  const secret = parsed.searchParams.get('secret');
  if (
    parsed.protocol !== 'otpauth:'
    || parsed.hostname.toLowerCase() !== 'totp'
    || parsed.username
    || parsed.password
    || parsed.hash
    || secret === null
    || secret.length === 0
    || secret.length > 512
    || /\s/u.test(secret)
  ) {
    invalidResponse();
  }
  return raw;
}

function decodeBackupCodes(value: unknown): string[] {
  return decodeUniqueStrings(
    value,
    MAX_BACKUP_CODES,
    MAX_BACKUP_CODE_LENGTH,
  );
}

function decodeUniqueStrings(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    invalidResponse();
  }
  const decoded = value.map((entry) => nonEmptyString(entry, maxLength));
  if (decoded.some((entry) => entry.trim().length === 0)) invalidResponse();
  if (new Set(decoded).size !== decoded.length) invalidResponse();
  return decoded;
}

function nonEmptyString(value: unknown, maxLength: number): string {
  const decoded = asString(value);
  if (decoded.length === 0 || decoded.length > maxLength) invalidResponse();
  return decoded;
}

function decodeOptionalString<Key extends string>(
  row: Record<string, unknown>,
  key: Key,
): { [K in Key]?: string } {
  const value = row[key];
  if (value === undefined || value === null) return {};
  return { [key]: nonEmptyString(value, MAX_REDIRECT_URL_LENGTH) } as {
    [K in Key]?: string;
  };
}

function decodeOptionalNullableString<Key extends string>(
  row: Record<string, unknown>,
  key: Key,
  maxLength: number,
): { [K in Key]?: string | null } {
  const value = optionalNullableString(row, key);
  if (value === undefined) return {};
  if (value !== null && value.length > maxLength) invalidResponse();
  return { [key]: value } as { [K in Key]?: string | null };
}
