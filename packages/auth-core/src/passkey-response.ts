import type {
  AuthPasskey,
  DeletePasskeyData,
  PasskeyAuthData,
  UpdatePasskeyData,
} from './client';
import {
  asBoolean,
  asDate,
  asRecord,
  asString,
  decodeAuthSession,
  decodeAuthUser,
  decodeJsonObject,
  invalidResponse,
  optionalNullableString,
  type RuntimeJsonObject,
} from './response-schema';
import type {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { isCanonicalPasskeyName } from './passkey-name';

export type AuthenticationOptions =
  Parameters<typeof startAuthentication>[0]['optionsJSON'];
export type RegistrationOptions =
  Parameters<typeof startRegistration>[0]['optionsJSON'];
type UserVerification = NonNullable<AuthenticationOptions['userVerification']>;
type CredentialDescriptor = NonNullable<
  AuthenticationOptions['allowCredentials']
>[number];
type AuthenticatorTransport = NonNullable<
  CredentialDescriptor['transports']
>[number];
type PublicKeyHint = NonNullable<AuthenticationOptions['hints']>[number];
type Attestation = NonNullable<RegistrationOptions['attestation']>;
type AttestationFormat = NonNullable<
  RegistrationOptions['attestationFormats']
>[number];
type AuthenticatorAttachment = NonNullable<
  NonNullable<RegistrationOptions['authenticatorSelection']>[
    'authenticatorAttachment'
  ]
>;
type ResidentKey = NonNullable<
  NonNullable<RegistrationOptions['authenticatorSelection']>['residentKey']
>;

const MAX_CEREMONY_DEPTH = 12;
const MAX_CEREMONY_NODES = 5_000;
const MAX_EXTENSION_DEPTH = 8;
const MAX_EXTENSION_NODES = 1_000;
const MIN_CHALLENGE_BYTES = 16;
const MAX_CHALLENGE_BYTES = 512;
const MAX_CREDENTIALS = 100;
const MAX_CREDENTIAL_ID_LENGTH = 8_192;
const MAX_PUBLIC_KEY_LENGTH = 32_768;
const MAX_NAME_LENGTH = 1_024;
const MAX_SMALL_STRING_LENGTH = 256;
const MAX_COLLECTION_LENGTH = 64;
const MAX_TIMEOUT_MS = 600_000;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CONTROL_OR_BIDI =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const AAGUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const USER_VERIFICATION = new Set<UserVerification>([
  'discouraged',
  'preferred',
  'required',
]);
const DEVICE_TYPES = new Set<AuthPasskey['deviceType']>([
  'singleDevice',
  'multiDevice',
]);
const TRANSPORTS = new Set<AuthenticatorTransport>([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);
const HINTS = new Set<PublicKeyHint>([
  'hybrid',
  'security-key',
  'client-device',
]);
const ATTESTATIONS = new Set<Attestation>([
  'none',
  'indirect',
  'direct',
  'enterprise',
]);
const ATTESTATION_FORMATS = new Set<AttestationFormat>([
  'fido-u2f',
  'packed',
  'android-safetynet',
  'android-key',
  'tpm',
  'apple',
  'none',
]);
const AUTHENTICATOR_ATTACHMENTS = new Set<AuthenticatorAttachment>([
  'platform',
  'cross-platform',
]);
const RESIDENT_KEYS = new Set<ResidentKey>([
  'discouraged',
  'preferred',
  'required',
]);
const SUPPORTED_COSE_ALGORITHMS = new Set([-8, -7, -257]);

export function decodeAuthenticationOptions(value: unknown): AuthenticationOptions {
  const options = decodeJsonObject(
    value,
    MAX_CEREMONY_DEPTH,
    MAX_CEREMONY_NODES,
  );
  return {
    challenge: challenge(options.challenge),
    ...optionalField('timeout', optionalTimeout(options.timeout)),
    ...optionalField(
      'rpId',
      optionalRpId(options.rpId),
    ),
    ...optionalField(
      'allowCredentials',
      optionalCredentialDescriptors(options.allowCredentials),
    ),
    ...optionalField(
      'userVerification',
      optionalEnum(options.userVerification, USER_VERIFICATION),
    ),
    ...optionalField('hints', optionalEnumArray(options.hints, HINTS)),
    ...optionalField('extensions', optionalRecord(options.extensions)),
  };
}

export function decodeRegistrationOptions(value: unknown): RegistrationOptions {
  const options = decodeJsonObject(
    value,
    MAX_CEREMONY_DEPTH,
    MAX_CEREMONY_NODES,
  );
  return {
    challenge: challenge(options.challenge),
    rp: decodeRp(options.rp),
    user: decodeRegistrationUser(options.user),
    pubKeyCredParams: decodePublicKeyParameters(options.pubKeyCredParams),
    ...optionalField('timeout', optionalTimeout(options.timeout)),
    ...optionalField(
      'excludeCredentials',
      optionalCredentialDescriptors(options.excludeCredentials),
    ),
    ...optionalField(
      'authenticatorSelection',
      optionalAuthenticatorSelection(options.authenticatorSelection),
    ),
    ...optionalField(
      'attestation',
      optionalEnum(options.attestation, ATTESTATIONS),
    ),
    ...optionalField(
      'attestationFormats',
      optionalEnumArray(options.attestationFormats, ATTESTATION_FORMATS),
    ),
    ...optionalField('hints', optionalEnumArray(options.hints, HINTS)),
    ...optionalField('extensions', optionalRecord(options.extensions)),
  };
}

export function decodePasskeyAuthentication(value: unknown): PasskeyAuthData {
  const row = asRecord(value);
  const session = decodeAuthSession(row.session);
  const user = decodeAuthUser(row.user);
  if (session.userId !== user.id) invalidResponse();
  return { session, user };
}

export function decodePasskey(value: unknown): AuthPasskey {
  const row = asRecord(value);
  const counter = row.counter;
  if (!Number.isSafeInteger(counter) || (counter as number) < 0) {
    invalidResponse();
  }
  const deviceType = requiredEnum(row.deviceType, DEVICE_TYPES);
  const backedUp = asBoolean(row.backedUp);
  if (backedUp && deviceType !== 'multiDevice') invalidResponse();
  return {
    id: boundedString(row.id, MAX_SMALL_STRING_LENGTH),
    ...optionalPasskeyNameField(row),
    publicKey: standardBase64(row.publicKey, MAX_PUBLIC_KEY_LENGTH),
    userId: boundedString(row.userId, MAX_SMALL_STRING_LENGTH),
    credentialID: base64Url(row.credentialID, MAX_CREDENTIAL_ID_LENGTH),
    counter: counter as number,
    deviceType,
    backedUp,
    ...optionalTransports(row),
    createdAt: asDate(row.createdAt),
    ...optionalAaguid(row),
  };
}

export function decodeRegisteredPasskey(
  value: unknown,
  expectedCredentialId: string,
  expectedName: string | undefined,
): AuthPasskey {
  const passkey = decodePasskey(value);
  if (
    passkey.credentialID !== expectedCredentialId
    || (
      expectedName === undefined
        ? passkey.name !== undefined && passkey.name !== null
        : passkey.name !== expectedName
    )
  ) {
    invalidResponse();
  }
  return passkey;
}

export function decodePasskeys(value: unknown): AuthPasskey[] {
  if (!Array.isArray(value) || value.length > MAX_CREDENTIALS) invalidResponse();
  const passkeys = value.map(decodePasskey);
  rejectDuplicates(passkeys.map((passkey) => passkey.id));
  rejectDuplicates(passkeys.map((passkey) => passkey.credentialID));
  if (
    passkeys.length > 1
    && passkeys.some((passkey) => passkey.userId !== passkeys[0]?.userId)
  ) {
    invalidResponse();
  }
  return passkeys;
}

export function decodeUpdatedPasskey(
  value: unknown,
  expectedId: string,
  expectedName: string,
): UpdatePasskeyData {
  const row = asRecord(value);
  const passkey = decodePasskey(row.passkey);
  if (passkey.id !== expectedId || passkey.name !== expectedName) {
    invalidResponse();
  }
  return { passkey };
}

export function decodeDeletedPasskey(value: unknown): DeletePasskeyData {
  if (asRecord(value).status !== true) invalidResponse();
  return { status: true };
}

function decodeRp(value: unknown): RegistrationOptions['rp'] {
  const row = asRecord(value);
  return {
    name: safeHumanString(row.name, MAX_NAME_LENGTH),
    ...optionalField('id', optionalRpId(row.id)),
  };
}

function decodeRegistrationUser(value: unknown): RegistrationOptions['user'] {
  const row = asRecord(value);
  return {
    id: base64Url(row.id, 128, 1, 64),
    name: safeHumanString(row.name, MAX_NAME_LENGTH),
    displayName: safeHumanString(row.displayName, MAX_NAME_LENGTH),
  };
}

function decodePublicKeyParameters(
  value: unknown,
): RegistrationOptions['pubKeyCredParams'] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > MAX_COLLECTION_LENGTH
  ) {
    invalidResponse();
  }
  const parameters = value.map((entry) => {
    const row = asRecord(entry);
    if (
      row.type !== 'public-key'
      || !Number.isSafeInteger(row.alg)
      || !SUPPORTED_COSE_ALGORITHMS.has(row.alg as number)
    ) {
      invalidResponse();
    }
    return { type: 'public-key' as const, alg: row.alg as number };
  });
  rejectNumberDuplicates(parameters.map((parameter) => parameter.alg));
  return parameters;
}

function optionalCredentialDescriptors(
  value: unknown,
): AuthenticationOptions['allowCredentials'] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CREDENTIALS) invalidResponse();
  const descriptors = value.map((entry) => {
    const row = asRecord(entry);
    if (row.type !== 'public-key') invalidResponse();
    return {
      type: 'public-key' as const,
      id: base64Url(row.id, MAX_CREDENTIAL_ID_LENGTH),
      ...optionalField(
        'transports',
        optionalEnumArray(row.transports, TRANSPORTS),
      ),
    };
  });
  rejectDuplicates(descriptors.map((descriptor) => descriptor.id));
  return descriptors;
}

function optionalAuthenticatorSelection(
  value: unknown,
): RegistrationOptions['authenticatorSelection'] | undefined {
  if (value === undefined) return undefined;
  const row = asRecord(value);
  if (
    row.requireResidentKey !== undefined
    && typeof row.requireResidentKey !== 'boolean'
  ) {
    invalidResponse();
  }
  const residentKey = optionalEnum(row.residentKey, RESIDENT_KEYS);
  if (
    row.requireResidentKey !== undefined
    && residentKey !== undefined
    && row.requireResidentKey !== (residentKey === 'required')
  ) {
    invalidResponse();
  }
  return {
    ...optionalField(
      'authenticatorAttachment',
      optionalEnum(row.authenticatorAttachment, AUTHENTICATOR_ATTACHMENTS),
    ),
    ...optionalField('residentKey', residentKey),
    ...optionalField(
      'requireResidentKey',
      row.requireResidentKey as boolean | undefined,
    ),
    ...optionalField(
      'userVerification',
      optionalEnum(row.userVerification, USER_VERIFICATION),
    ),
  };
}

function optionalTimeout(value: unknown): number | undefined {
  if (
    value !== undefined
    && (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < 0
      || value > MAX_TIMEOUT_MS
    )
  ) {
    invalidResponse();
  }
  return value as number | undefined;
}

function optionalRecord(value: unknown): RuntimeJsonObject | undefined {
  return value === undefined
    ? undefined
    : decodeJsonObject(value, MAX_EXTENSION_DEPTH, MAX_EXTENSION_NODES);
}

function optionalEnumArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value)
    || value.length > MAX_COLLECTION_LENGTH
  ) {
    invalidResponse();
  }
  const decoded = value.map((entry) => requiredEnum(entry, allowed));
  rejectDuplicates(decoded);
  return decoded;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | undefined {
  if (value === undefined) return undefined;
  return requiredEnum(value, allowed);
}

function challenge(value: unknown): string {
  return base64Url(
    value,
    Math.ceil(MAX_CHALLENGE_BYTES * 4 / 3),
    MIN_CHALLENGE_BYTES,
    MAX_CHALLENGE_BYTES,
  );
}

function base64Url(
  value: unknown,
  maxLength: number,
  minBytes = 1,
  maxBytes = Number.POSITIVE_INFINITY,
): string {
  const decoded = boundedString(value, maxLength);
  const remainder = decoded.length % 4;
  const lastValue = base64UrlCharacterValue(decoded.at(-1) ?? '');
  const byteLength = Math.floor(decoded.length * 3 / 4);
  if (
    !BASE64URL.test(decoded)
    || remainder === 1
    || (remainder === 2 && (lastValue & 0b1111) !== 0)
    || (remainder === 3 && (lastValue & 0b11) !== 0)
    || byteLength < minBytes
    || byteLength > maxBytes
  ) {
    invalidResponse();
  }
  return decoded;
}

function boundedString(value: unknown, maxLength: number): string {
  const decoded = asString(value);
  if (decoded.length === 0 || decoded.length > maxLength) invalidResponse();
  return decoded;
}

function safeHumanString(value: unknown, maxLength: number): string {
  const decoded = boundedString(value, maxLength);
  if (CONTROL_OR_BIDI.test(decoded)) invalidResponse();
  return decoded;
}

function optionalRpId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const decoded = boundedString(value, 253);
  if (
    decoded !== 'localhost'
    && (
      decoded.endsWith('.')
      || !decoded.includes('.')
      || decoded.split('.').some((label) => !HOST_LABEL.test(label))
    )
  ) {
    invalidResponse();
  }
  return decoded;
}

function standardBase64(value: unknown, maxLength: number): string {
  const decoded = boundedString(value, maxLength);
  const doublePadding = decoded.endsWith('==');
  const singlePadding = !doublePadding && decoded.endsWith('=');
  const lastDataCharacter = decoded.at(doublePadding ? -3 : singlePadding ? -2 : -1)
    ?? '';
  const lastValue = base64CharacterValue(lastDataCharacter);
  if (
    decoded.length % 4 !== 0
    || !BASE64.test(decoded)
    || (doublePadding && (lastValue & 0b1111) !== 0)
    || (singlePadding && (lastValue & 0b11) !== 0)
  ) {
    invalidResponse();
  }
  return decoded;
}

function base64UrlCharacterValue(character: string): number {
  return base64CharacterValue(character, true);
}

function base64CharacterValue(character: string, urlSafe = false): number {
  const alphabet = urlSafe
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return alphabet.indexOf(character);
}

function optionalPasskeyNameField(
  row: Record<string, unknown>,
): { name?: string | null } {
  const value = optionalNullableString(row, 'name');
  if (value === undefined) return {};
  if (value !== null && !isCanonicalPasskeyName(value)) {
    invalidResponse();
  }
  return { name: value };
}

function optionalTransports(
  row: Record<string, unknown>,
): { transports?: string | null } {
  const value = optionalNullableString(row, 'transports');
  if (value === undefined || value === null || value === '') {
    return value === undefined ? {} : { transports: value };
  }
  const transports = value.split(',');
  if (
    transports.length > MAX_COLLECTION_LENGTH
    || transports.some(
      (entry) => !TRANSPORTS.has(entry as AuthenticatorTransport),
    )
    || new Set(transports).size !== transports.length
  ) {
    invalidResponse();
  }
  return { transports: value };
}

function optionalAaguid(
  row: Record<string, unknown>,
): { aaguid?: string | null } {
  const value = optionalNullableString(row, 'aaguid');
  if (value === undefined || value === null) {
    return value === undefined ? {} : { aaguid: null };
  }
  if (!AAGUID.test(value)) invalidResponse();
  return { aaguid: value };
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T {
  const decoded = asString(value);
  if (!allowed.has(decoded as T)) invalidResponse();
  return decoded as T;
}

function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [K in Key]?: Value } {
  return value === undefined ? {} : { [key]: value } as { [K in Key]?: Value };
}

function rejectDuplicates(values: string[]): void {
  if (new Set(values).size !== values.length) invalidResponse();
}

function rejectNumberDuplicates(values: number[]): void {
  if (new Set(values).size !== values.length) invalidResponse();
}
