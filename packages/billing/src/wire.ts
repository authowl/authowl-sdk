const BILLING_REASONS = [
  'not_connected',
  'no_customer',
  'erased',
  'no_organization',
] as const;
const ENTITLEMENT_STATUSES = ['ok', ...BILLING_REASONS] as const;
const CHECK_REASONS = [...BILLING_REASONS, 'not_granted'] as const;
const ENTITLEMENT_SOURCES = ['snapshot', 'live', 'none'] as const;
const BILLING_SUBJECT_TYPES = ['user', 'organization'] as const;

export type BillingReason = typeof BILLING_REASONS[number];
export type EntitlementStatus = typeof ENTITLEMENT_STATUSES[number];
export type EntitlementSource = typeof ENTITLEMENT_SOURCES[number];

export type BillingSubject = Readonly<{
  type: typeof BILLING_SUBJECT_TYPES[number];
  id: string;
}>;

export type EntitlementView = Readonly<{
  feature: string;
  kind: string;
  allowed: boolean;
  balance: number | null;
}>;

export type EntitlementList = Readonly<{
  status: EntitlementStatus;
  subject: BillingSubject | null;
  source: EntitlementSource;
  fetchedAt: string | null;
  entitlements: readonly EntitlementView[];
}>;

export type EntitlementCheck = Readonly<{
  feature: string;
  allowed: boolean;
  kind: string | null;
  balance: number | null;
  reason: BillingReason | 'not_granted' | null;
  source: EntitlementSource;
}>;

export function decodeEntitlementList(value: unknown): EntitlementList {
  const row = record(value);
  const entitlements = array(row.entitlements);
  if (entitlements.length > 1000) invalid();
  return Object.freeze({
    status: oneOf(row.status, ENTITLEMENT_STATUSES),
    subject: decodeSubject(row.subject),
    source: oneOf(row.source, ENTITLEMENT_SOURCES),
    fetchedAt: nullableString(row.fetchedAt),
    entitlements: Object.freeze(entitlements.map(decodeEntitlement)),
  });
}

export function decodeEntitlementCheck(value: unknown): EntitlementCheck {
  const row = record(value);
  const reason = row.reason === null ? null : oneOf(row.reason, CHECK_REASONS);
  return Object.freeze({
    feature: string(row.feature),
    allowed: boolean(row.allowed),
    kind: nullableString(row.kind),
    balance: nullableNumber(row.balance),
    reason,
    source: oneOf(row.source, ENTITLEMENT_SOURCES),
  });
}

function decodeEntitlement(value: unknown): EntitlementView {
  const row = record(value);
  return Object.freeze({
    feature: string(row.feature),
    kind: string(row.kind),
    allowed: boolean(row.allowed),
    balance: nullableNumber(row.balance),
  });
}

function decodeSubject(value: unknown): BillingSubject | null {
  if (value === null) return null;
  const row = record(value);
  return Object.freeze({
    type: oneOf(row.type, BILLING_SUBJECT_TYPES),
    id: string(row.id),
  });
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  const result = string(value);
  if (!(allowed as readonly string[]).includes(result)) invalid();
  return result as T[number];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return string(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}

function invalid(): never {
  throw new TypeError('Invalid billing response.');
}
