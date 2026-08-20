import type { AuthSession, AuthUser } from './client';
import type { OrganizationMembership } from './organization-membership';

export type WireRecord = Record<string, unknown>;
export type RuntimeJsonPrimitive = string | number | boolean | null;
export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | RuntimeJsonObject
  | RuntimeJsonValue[];
export type RuntimeJsonObject = { [key: string]: RuntimeJsonValue };

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function asRecord(value: unknown): WireRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidResponse();
  return value as WireRecord;
}

export function asString(value: unknown): string {
  if (typeof value !== 'string') invalidResponse();
  return value;
}

export function asBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalidResponse();
  return value;
}

export function asDate(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalidResponse();
  return value;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    invalidResponse();
  }
  return [...value] as string[];
}

export function optionalNullableString(
  record: WireRecord,
  key: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null || typeof value === 'string') return value;
  return invalidResponse();
}

export function optionalNullableBoolean(
  record: WireRecord,
  key: string,
): boolean | null | undefined {
  const value = record[key];
  if (value === undefined || value === null || typeof value === 'boolean') return value;
  return invalidResponse();
}

export function decodeAuthUser(value: unknown): AuthUser {
  const row = asRecord(value);
  const email = row.email;
  if (email !== null && typeof email !== 'string') invalidResponse();
  return {
    id: asString(row.id),
    email,
    emailVerified: asBoolean(row.emailVerified),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    ...optionalField('phoneNumber', optionalNullableString(row, 'phoneNumber')),
    ...optionalField('username', optionalNullableString(row, 'username')),
    ...optionalField('displayUsername', optionalNullableString(row, 'displayUsername')),
    ...optionalField('firstName', optionalNullableString(row, 'firstName')),
    ...optionalField('lastName', optionalNullableString(row, 'lastName')),
    ...optionalField('name', optionalNullableString(row, 'name')),
    ...optionalField('image', optionalNullableString(row, 'image')),
    ...optionalField(
      'twoFactorEnabled',
      optionalNullableBoolean(row, 'twoFactorEnabled'),
    ),
  };
}

export function decodeAuthSession(value: unknown): AuthSession {
  const row = asRecord(value);
  const membership = row.membership;
  return {
    id: asString(row.id),
    userId: asString(row.userId),
    expiresAt: asDate(row.expiresAt),
    ...optionalField(
      'activeOrganizationId',
      optionalNullableString(row, 'activeOrganizationId'),
    ),
    ...optionalField('activeTeamId', optionalNullableString(row, 'activeTeamId')),
    ...optionalField(
      'membership',
      membership === undefined || membership === null
        ? membership
        : decodeMembership(membership),
    ),
    ...optionalField(
      'pendingMfaEnrollment',
      optionalNullableBoolean(row, 'pendingMfaEnrollment'),
    ),
  };
}

export function invalidResponse(): never {
  throw new TypeError('AuthOwl response does not match its runtime contract.');
}

export function decodeJsonObject(
  value: unknown,
  maxDepth = 20,
  maxNodes = 10_000,
): RuntimeJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  return decodeJsonValue(value, maxDepth, maxNodes) as RuntimeJsonObject;
}

export function decodeJsonValue(
  value: unknown,
  maxDepth = 20,
  maxNodes = 10_000,
): RuntimeJsonValue {
  return decodeJsonNode(value, 0, { nodes: 0 }, maxDepth, maxNodes);
}

function decodeMembership(value: unknown): OrganizationMembership {
  const row = asRecord(value);
  return {
    role: asString(row.role),
    ...(row.roles === undefined ? {} : { roles: asStringArray(row.roles) }),
    permissions: asStringArray(row.permissions),
    ...(row.teams === undefined ? {} : { teams: asStringArray(row.teams) }),
  };
}

function decodeJsonNode(
  value: unknown,
  depth: number,
  budget: { nodes: number },
  maxDepth: number,
  maxNodes: number,
): RuntimeJsonValue {
  budget.nodes += 1;
  if (depth > maxDepth || budget.nodes > maxNodes) invalidResponse();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidResponse();
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      decodeJsonNode(entry, depth + 1, budget, maxDepth, maxNodes));
  }
  if (!value || typeof value !== 'object') invalidResponse();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidResponse();
  const decoded: RuntimeJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) invalidResponse();
    decoded[key] = decodeJsonNode(entry, depth + 1, budget, maxDepth, maxNodes);
  }
  return decoded;
}

function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [K in Key]?: Value } {
  return value === undefined ? {} : { [key]: value } as { [K in Key]?: Value };
}
