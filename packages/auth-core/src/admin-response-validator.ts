import {
  adminComponentSchemas,
  adminOperations,
  type AdminOperationId,
} from './admin-operations.generated';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_SCHEMA_DEPTH = 64;
const MAX_RESPONSE_NODES = 50_000;

type JsonSchema = Record<string, unknown>;

/** Validate one successful Admin API response against its generated OpenAPI schema. */
export function decodeAdminOperationResponse(
  operationId: AdminOperationId,
  status: number,
  value: unknown,
): unknown {
  const operation = adminOperations[operationId];
  const schemas = operation.responseSchemas as Readonly<Record<string, unknown>>;
  if (!Object.hasOwn(schemas, String(status))) invalidAdminResponse();
  const schema = schemas[String(status)];
  if (schema === null) {
    if (value !== null) invalidAdminResponse();
    return undefined;
  }
  const budget = { nodes: 0 };
  if (!matchesSchema(value, asSchema(schema), 0, budget)) invalidAdminResponse();
  return value;
}

function matchesSchema(
  value: unknown,
  schema: JsonSchema,
  depth: number,
  budget: { nodes: number },
): boolean {
  budget.nodes += 1;
  if (depth > MAX_SCHEMA_DEPTH || budget.nodes > MAX_RESPONSE_NODES) return false;

  if (typeof schema.$ref === 'string') {
    const referenced = resolveComponentSchema(schema.$ref);
    if (
      referenced === null
      || !matchesSchema(value, referenced, depth + 1, budget)
    ) {
      return false;
    }
  }
  if (
    Array.isArray(schema.allOf)
    && !schema.allOf.every((entry) =>
      matchesSchema(value, asSchema(entry), depth + 1, budget))
  ) {
    return false;
  }
  if (
    Array.isArray(schema.oneOf)
    && schema.oneOf.filter((entry) =>
      matchesSchema(value, asSchema(entry), depth + 1, budget)).length !== 1
  ) {
    return false;
  }
  if (
    Array.isArray(schema.enum)
    && !schema.enum.some((entry) => Object.is(entry, value))
  ) {
    return false;
  }
  if (schema.const !== undefined && !Object.is(schema.const, value)) return false;

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (
    schema.type !== undefined
    && !types.some((type) => matchesType(value, type))
  ) {
    return false;
  }
  if (value === null) return schema.type === undefined || types.includes('null');

  if (typeof value === 'string') return matchesString(value, schema);
  if (typeof value === 'number') return matchesNumber(value, schema);
  if (Array.isArray(value)) return matchesArray(value, schema, depth, budget);
  if (isRecord(value)) return matchesObject(value, schema, depth, budget);
  return typeof value === 'boolean';
}

function matchesType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isSafeInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function matchesString(value: string, schema: JsonSchema): boolean {
  if (
    (typeof schema.minLength === 'number' && value.length < schema.minLength)
    || (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
  ) {
    return false;
  }
  if (typeof schema.pattern === 'string') {
    if (!matchesKnownPattern(value, schema.pattern)) return false;
  }
  switch (schema.format) {
    case undefined:
      return true;
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      );
    case 'date-time':
      return (
        /^\d{4}-\d{2}-\d{2}T/.test(value)
        && Number.isFinite(Date.parse(value))
      );
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'uri':
      try {
        const url = new URL(value);
        return url.protocol.length > 1;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function matchesKnownPattern(value: string, pattern: string): boolean {
  switch (pattern) {
    case '^[a-z0-9]+(?:-[a-z0-9]+)*$':
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
    case '^[a-z][a-z0-9_-]*$':
      return /^[a-z][a-z0-9_-]*$/.test(value);
    case '^[A-Za-z0-9][A-Za-z0-9._:/-]*$':
      return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
    case '^[a-z][a-z0-9_]{0,63}$':
      return /^[a-z][a-z0-9_]{0,63}$/.test(value);
    case '^[A-Za-z][A-Za-z0-9_]{0,63}$':
      return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
    default:
      // A newly generated pattern requires an explicit reviewed implementation.
      return false;
  }
}

function matchesNumber(value: number, schema: JsonSchema): boolean {
  return (
    Number.isFinite(value)
    && !(typeof schema.minimum === 'number' && value < schema.minimum)
    && !(typeof schema.maximum === 'number' && value > schema.maximum)
  );
}

function matchesArray(
  value: unknown[],
  schema: JsonSchema,
  depth: number,
  budget: { nodes: number },
): boolean {
  if (
    (typeof schema.minItems === 'number' && value.length < schema.minItems)
    || (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
  ) {
    return false;
  }
  if (
    schema.uniqueItems === true
    && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length
  ) {
    return false;
  }
  if (schema.items === undefined) return true;
  const itemSchema = asSchema(schema.items);
  return value.every((entry) =>
    matchesSchema(entry, itemSchema, depth + 1, budget));
}

function matchesObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  depth: number,
  budget: { nodes: number },
): boolean {
  const keys = Object.keys(value);
  if (
    keys.some((key) => FORBIDDEN_KEYS.has(key))
    || (typeof schema.minProperties === 'number' && keys.length < schema.minProperties)
    || (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties)
  ) {
    return false;
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (
    schema.propertyNames !== undefined
    && keys.some((key) =>
      !matchesSchema(key, asSchema(schema.propertyNames), depth + 1, budget))
  ) {
    return false;
  }
  if (
    Array.isArray(schema.required)
    && schema.required.some(
      (key) => typeof key !== 'string' || !Object.hasOwn(value, key),
    )
  ) {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema !== undefined) {
      if (!matchesSchema(entry, asSchema(propertySchema), depth + 1, budget)) return false;
      continue;
    }
    if (schema.additionalProperties === false) return false;
    if (
      isRecord(schema.additionalProperties)
      && !matchesSchema(entry, schema.additionalProperties, depth + 1, budget)
    ) {
      return false;
    }
  }
  return true;
}

function resolveComponentSchema(reference: string): JsonSchema | null {
  const prefix = '#/components/schemas/';
  if (!reference.startsWith(prefix)) return null;
  const name = reference.slice(prefix.length);
  if (!Object.hasOwn(adminComponentSchemas, name)) return null;
  return asSchema(
    (adminComponentSchemas as Readonly<Record<string, unknown>>)[name],
  );
}

function asSchema(value: unknown): JsonSchema {
  if (!isRecord(value)) invalidAdminResponse();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidAdminResponse(): never {
  throw new TypeError('Admin API response does not match its generated contract.');
}
