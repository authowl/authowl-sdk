import type { ResolvedAuthConfig } from './config';
import { requestPublishableJson, requireOk } from './http';
import { asBoolean, asRecord } from './response-schema';

/** Legal-consent status for the signed-in user (server contract: `GET /consent`). */
export type ConsentStatus = {
  /** Whether the project has an active consent gate at all. */
  required: boolean;
  /**
   * True when the signed-in user must (re-)accept the current version — either
   * never accepted, or the operator bumped the version since they did. Absent
   * when `required` is false or the user isn't signed in.
   */
  needsConsent?: boolean;
  version?: number;
  termsUrl?: string;
  privacyUrl?: string;
};

export type ConsentAcceptResult = { ok: boolean; version?: number };

function consentUrl(config: ResolvedAuthConfig): string {
  const origin = new URL(config.apiUrl).origin;
  return `${origin}/api/projects/${config.decoded.projectId}/consent`;
}

/**
 * Fetch the signed-in user's consent status. Sent WITH cookies (needs the
 * session). A 401 (not signed in) resolves to `{ required: false }` — new users
 * are handled by the sign-up consent gate, not this one.
 */
export async function getConsentStatus(config: ResolvedAuthConfig): Promise<ConsentStatus> {
  const result = await requestPublishableJson(config, consentUrl(config), {
    init: {
      method: 'GET',
      credentials: 'include',
    },
    maxResponseBytes: 64 * 1024,
    decode: decodeConsentStatus,
  });
  if (result.response.status === 401) return { required: false };
  return requireOk(result, 'consent status');
}

/**
 * Record the signed-in user's acceptance of the terms version they were shown.
 * `version` is echoed from {@link getConsentStatus} so the server records only the
 * exact version the UI displayed; if the operator bumped it in between, the server
 * rejects with 409 (surfaced as a thrown error) and the caller should re-fetch.
 */
export async function acceptConsent(
  config: ResolvedAuthConfig,
  version: number,
): Promise<ConsentAcceptResult> {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('Consent version must be a positive integer.');
  }
  return requireOk(await requestPublishableJson(config, consentUrl(config), {
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ version }),
    },
    maxResponseBytes: 64 * 1024,
    decode: decodeConsentAcceptResult,
  }), 'consent accept');
}

function decodeConsentStatus(value: unknown): ConsentStatus {
  const row = asRecord(value);
  const required = asBoolean(row.required);
  const needsConsent = optionalBoolean(row.needsConsent);
  const version = optionalPositiveInteger(row.version);
  const termsUrl = optionalString(row.termsUrl);
  const privacyUrl = optionalString(row.privacyUrl);
  return {
    required,
    ...(needsConsent === undefined ? {} : { needsConsent }),
    ...(version === undefined ? {} : { version }),
    ...(termsUrl === undefined ? {} : { termsUrl }),
    ...(privacyUrl === undefined ? {} : { privacyUrl }),
  };
}

function decodeConsentAcceptResult(value: unknown): ConsentAcceptResult {
  const row = asRecord(value);
  const version = optionalPositiveInteger(row.version);
  return {
    ok: asBoolean(row.ok),
    ...(version === undefined ? {} : { version }),
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new TypeError('Invalid consent response.');
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (
    value === undefined
    || (Number.isSafeInteger(value) && (value as number) >= 1)
  ) {
    return value as number | undefined;
  }
  throw new TypeError('Invalid consent response.');
}

function optionalString(value: unknown): string | undefined {
  if (
    value === undefined
    || (typeof value === 'string' && value.length <= 4096)
  ) {
    return value;
  }
  throw new TypeError('Invalid consent response.');
}
