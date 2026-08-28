import type { ActionFetchOptions, AuthActionResult } from './client';
import type { AuthHttpClient } from './http-client';
import { createIdempotencyKey } from './idempotency';
import {
  asDate,
  asRecord,
  asString,
  invalidResponse,
} from './response-schema';

export type PrivacyLocale = 'en' | 'ar';
export type PrivacyConsentState = 'granted' | 'refused' | 'withdrawn';
export type PrivacyRightType =
  | 'access'
  | 'correction'
  | 'portability'
  | 'erasure'
  | 'restriction'
  | 'objection'
  | 'consent_withdrawal';
export type PrivacyRightState =
  | 'received'
  | 'identity_pending'
  | 'in_progress'
  | 'restricted'
  | 'completed'
  | 'denied'
  | 'withdrawn';

export interface PrivacyConsentPreference {
  purposeId: string;
  purposeVersionId: string;
  code: string;
  state: PrivacyConsentState | null;
  updatedAt: Date | null;
  decidedAt: Date | null;
}

export interface PrivacyRightsRequest {
  id: string;
  rightType: PrivacyRightType;
  state: PrivacyRightState;
  locale: PrivacyLocale;
  receivedAt: Date;
  acknowledgedAt: Date | null;
  fulfilmentDeadline: Date;
  completedAt: Date | null;
}

export interface RecordPrivacyConsentOptions {
  purposeCode: string;
  purposeVersionId: string;
  noticeVersionId: string;
  decision: PrivacyConsentState;
  locale: PrivacyLocale;
  /** Stable retry key. A secure UUID is generated when omitted. */
  correlationId?: string;
}

export interface CreatePrivacyRightsRequestOptions {
  rightType: PrivacyRightType;
  locale: PrivacyLocale;
}

export interface PrivacyClient {
  listConsentPreferences(
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<{ preferences: PrivacyConsentPreference[] }>>;
  recordConsent(
    params: RecordPrivacyConsentOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<{ recorded: true; decision: PrivacyConsentState; decidedAt: Date }>>;
  listRightsRequests(
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<{ requests: PrivacyRightsRequest[] }>>;
  createRightsRequest(
    params: CreatePrivacyRightsRequestOptions,
    fetchOptions?: ActionFetchOptions,
  ): Promise<AuthActionResult<{ request: PrivacyRightsRequest }>>;
}

export function createPrivacyClient(http: AuthHttpClient): PrivacyClient {
  return {
    listConsentPreferences: (fetchOptions) => http.request('/privacy/consent-decisions', {
      fetchOptions,
      decode: decodePreferences,
    }),
    recordConsent: (params, fetchOptions) => http.request('/privacy/consent-decisions', {
      method: 'POST',
      body: {
        ...params,
        correlationId: params.correlationId ?? createIdempotencyKey(),
      },
      fetchOptions,
      decode: decodeRecordedConsent,
    }),
    listRightsRequests: (fetchOptions) => http.request('/privacy/rights', {
      fetchOptions,
      decode: decodeRightsRequests,
    }),
    createRightsRequest: (params, fetchOptions) => http.request('/privacy/rights', {
      method: 'POST',
      body: params,
      fetchOptions,
      decode: decodeCreatedRightsRequest,
    }),
  };
}

function decodePreferences(value: unknown): { preferences: PrivacyConsentPreference[] } {
  const row = asRecord(value);
  if (!Array.isArray(row.preferences)) invalidResponse();
  return { preferences: row.preferences.map(decodePreference) };
}

function decodePreference(value: unknown): PrivacyConsentPreference {
  const row = asRecord(value);
  return {
    purposeId: asString(row.purposeId),
    purposeVersionId: asString(row.purposeVersionId),
    code: asString(row.code),
    state: nullableEnum(row.state, ['granted', 'refused', 'withdrawn'] as const),
    updatedAt: nullableDate(row.updatedAt),
    decidedAt: nullableDate(row.decidedAt),
  };
}

function decodeRecordedConsent(value: unknown) {
  const row = asRecord(value);
  if (row.recorded !== true) invalidResponse();
  return {
    recorded: true as const,
    decision: requiredEnum(row.decision, ['granted', 'refused', 'withdrawn'] as const),
    decidedAt: wireDate(row.decidedAt),
  };
}

function decodeRightsRequests(value: unknown): { requests: PrivacyRightsRequest[] } {
  const row = asRecord(value);
  if (!Array.isArray(row.requests)) invalidResponse();
  return { requests: row.requests.map(decodeRightsRequest) };
}

function decodeCreatedRightsRequest(value: unknown): { request: PrivacyRightsRequest } {
  return { request: decodeRightsRequest(asRecord(value).request) };
}

function decodeRightsRequest(value: unknown): PrivacyRightsRequest {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    rightType: requiredEnum(row.rightType, [
      'access', 'correction', 'portability', 'erasure', 'restriction', 'objection',
      'consent_withdrawal',
    ] as const),
    state: requiredEnum(row.state, [
      'received', 'identity_pending', 'in_progress', 'restricted', 'completed', 'denied', 'withdrawn',
    ] as const),
    locale: requiredEnum(row.locale, ['en', 'ar'] as const),
    receivedAt: wireDate(row.receivedAt),
    acknowledgedAt: nullableDate(row.acknowledgedAt),
    fulfilmentDeadline: wireDate(row.fulfilmentDeadline),
    completedAt: nullableDate(row.completedAt),
  };
}

function nullableDate(value: unknown): Date | null {
  return value === null ? null : wireDate(value);
}

function wireDate(value: unknown): Date {
  if (value instanceof Date) return asDate(value);
  if (typeof value !== 'string') invalidResponse();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalidResponse();
  return date;
}

function requiredEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) invalidResponse();
  return value as Values[number];
}

function nullableEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] | null {
  return value === null ? null : requiredEnum(value, values);
}
