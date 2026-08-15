const DEFAULT_TOLERANCE_SECONDS = 300;
const MAX_TOLERANCE_SECONDS = 3600;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SIGNATURES = 4;
const MAX_SECRETS = 2;
const SIGNATURE_PATTERN = /^v1=([a-f0-9]{64})$/i;
const SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{1,256}$/;
const TIMESTAMP_PATTERN = /^(0|[1-9]\d{0,10})$/;

export type VerifyWebhookInput = {
  /** Exact request bytes. Do not parse and reserialize JSON before verification. */
  rawBody: string | ArrayBuffer | ArrayBufferView;
  timestamp: string;
  signatureHeader: string;
  /** Current and, during rotation overlap, previous endpoint secret. */
  secrets: readonly string[];
  /** Unix seconds, injectable for deterministic tests. */
  now?: number;
  /** Accepted timestamp skew. Defaults to 300 seconds and is capped at one hour. */
  toleranceSeconds?: number;
};

/**
 * Verify an AuthOwl webhook HMAC before parsing or acting on its body.
 *
 * Malformed untrusted headers fail closed with `false`. Invalid local
 * configuration throws so a broken endpoint cannot silently reject deliveries.
 */
export async function verifyWebhook(input: VerifyWebhookInput): Promise<boolean> {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Webhook verification input must be an object.');
  }
  const secrets = validateSecrets(input.secrets);
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (
    !Number.isSafeInteger(toleranceSeconds)
    || toleranceSeconds < 0
    || toleranceSeconds > MAX_TOLERANCE_SECONDS
  ) {
    throw new TypeError('Webhook toleranceSeconds must be an integer from 0 to 3600.');
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('Webhook now must be a non-negative Unix timestamp.');
  }
  const body = toBytes(input.rawBody);
  if (body.byteLength > MAX_BODY_BYTES) return false;
  if (
    typeof input.timestamp !== 'string'
    || !TIMESTAMP_PATTERN.test(input.timestamp)
  ) return false;
  const timestamp = Number(input.timestamp);
  if (
    !Number.isSafeInteger(timestamp)
    || Math.abs(now - timestamp) > toleranceSeconds
  ) return false;
  const signatures = parseSignatures(input.signatureHeader);
  if (signatures.length === 0) return false;

  const prefix = new TextEncoder().encode(`${input.timestamp}.`);
  const signed = new Uint8Array(prefix.byteLength + body.byteLength);
  signed.set(prefix);
  signed.set(body, prefix.byteLength);

  let matched = false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
    for (const supplied of signatures) {
      matched = constantTimeEqual(expected, supplied) || matched;
    }
  }
  return matched;
}

function validateSecrets(value: readonly string[]): readonly string[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > MAX_SECRETS
    || value.some((secret) => typeof secret !== 'string' || !SECRET_PATTERN.test(secret))
    || new Set(value).size !== value.length
  ) {
    throw new TypeError('Webhook secrets must contain one or two unique whsec_ values.');
  }
  return value;
}

function parseSignatures(value: string): Uint8Array[] {
  if (typeof value !== 'string' || value.length > 1024) return [];
  const entries = value.split(',');
  if (entries.length > MAX_SIGNATURES) return [];
  const signatures: Uint8Array[] = [];
  for (const entry of entries) {
    const match = SIGNATURE_PATTERN.exec(entry.trim());
    if (!match) continue;
    signatures.push(hexToBytes(match[1]!));
  }
  return signatures;
}

function toBytes(value: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('Webhook rawBody must be a string, ArrayBuffer, or ArrayBuffer view.');
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
