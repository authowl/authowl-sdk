import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import openapiTS, { astToString } from 'openapi-typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = path.join(ROOT, 'packages/auth-core/openapi/v1.json');
const TYPES_PATH = path.join(ROOT, 'packages/auth-core/src/admin-api.generated.ts');
const OPERATIONS_PATH = path.join(ROOT, 'packages/auth-core/src/admin-operations.generated.ts');
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const RESERVED_OPERATION_IDS = new Set(['__proto__', 'constructor', 'prototype', 'request']);
const RESPONSE_SCHEMA_KEYS = new Set([
  '$ref',
  'additionalProperties',
  'allOf',
  'const',
  'default',
  'description',
  'enum',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'oneOf',
  'pattern',
  'properties',
  'propertyNames',
  'required',
  'type',
  'uniqueItems',
]);
const RESPONSE_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);
const RESPONSE_SCHEMA_FORMATS = new Set(['date-time', 'email', 'uri', 'uuid']);
const RESPONSE_SCHEMA_PATTERNS = new Set([
  '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  '^[a-z][a-z0-9_-]*$',
  '^[A-Za-z0-9][A-Za-z0-9._:/-]*$',
  '^[a-z][a-z0-9_]{0,63}$',
  '^[A-Za-z][A-Za-z0-9_]{0,63}$',
]);

const args = process.argv.slice(2);
const check = args.includes('--check');
const sourceIndex = args.indexOf('--source');
const sourcePath = sourceIndex === -1 ? SNAPSHOT_PATH : path.resolve(args[sourceIndex + 1] ?? '');
const sync = sourcePath !== SNAPSHOT_PATH;

if (sourceIndex !== -1 && !args[sourceIndex + 1]) {
  throw new Error('--source requires a path to an OpenAPI JSON document');
}
if (check && sync) {
  throw new Error('--check cannot be combined with --source');
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
assertSupportedDocument(source);
assertSupportedResponseSchemas(source);

const snapshot = `${JSON.stringify(source, null, 2)}\n`;
const digest = createHash('sha256').update(snapshot).digest('hex');
const ast = await openapiTS(source, { immutable: true });
const types = astToString(ast);
const operations = renderOperations(source, digest);

const outputs = [
  ...(sync ? [[SNAPSHOT_PATH, snapshot]] : []),
  [TYPES_PATH, types],
  [OPERATIONS_PATH, operations],
];

if (check) {
  const stale = [];
  for (const [file, expected] of outputs) {
    const actual = await readFile(file, 'utf8').catch(() => '');
    if (actual !== expected) stale.push(path.relative(ROOT, file));
  }
  if (stale.length > 0) {
    throw new Error(`Generated Admin API files are stale: ${stale.join(', ')}. Run pnpm admin:generate.`);
  }
  console.log(`Admin API generated files match OpenAPI SHA-256 ${digest}.`);
  process.exit(0);
}

for (const [file, content] of outputs) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  console.log(`Wrote ${path.relative(ROOT, file)}.`);
}

function assertSupportedDocument(document) {
  if (typeof document !== 'object' || document === null || typeof document.openapi !== 'string') {
    throw new Error('Expected an OpenAPI JSON object');
  }
  if (typeof document.paths !== 'object' || document.paths === null) {
    throw new Error('OpenAPI document has no paths');
  }
}

function assertSupportedResponseSchemas(document) {
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    assertResponseSchema(document, schema, `components.schemas.${name}`);
  }
  for (const [route, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation?.responses) continue;
      for (const [status, rawResponse] of Object.entries(operation.responses)) {
        const response = resolveLocalRef(document, rawResponse);
        const schema = response?.content?.['application/json']?.schema;
        if (schema) {
          assertResponseSchema(document, schema, `${method.toUpperCase()} ${route} ${status}`);
        }
      }
    }
  }
}

function assertResponseSchema(document, schema, location) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`Unsupported Admin response schema at ${location}`);
  }
  const unsupported = Object.keys(schema).filter((key) => !RESPONSE_SCHEMA_KEYS.has(key));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported Admin response schema keyword at ${location}: ${unsupported.join(', ')}`);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type !== undefined && types.some((type) => !RESPONSE_SCHEMA_TYPES.has(type))) {
    throw new Error(`Unsupported Admin response schema type at ${location}`);
  }
  if (schema.format !== undefined && !RESPONSE_SCHEMA_FORMATS.has(schema.format)) {
    throw new Error(`Unsupported Admin response schema format at ${location}: ${schema.format}`);
  }
  if (
    schema.const !== undefined
    && !['boolean', 'number', 'string'].includes(typeof schema.const)
    && schema.const !== null
  ) {
    throw new Error(`Unsupported Admin response schema const at ${location}`);
  }
  if (schema.pattern !== undefined && !RESPONSE_SCHEMA_PATTERNS.has(schema.pattern)) {
    throw new Error(`Unsupported Admin response schema pattern at ${location}: ${schema.pattern}`);
  }
  if (schema.$ref !== undefined) resolveLocalRef(document, { $ref: schema.$ref });
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    assertResponseSchema(document, child, `${location}.properties.${name}`);
  }
  if (schema.propertyNames) {
    assertResponseSchema(document, schema.propertyNames, `${location}.propertyNames`);
  }
  if (schema.items) assertResponseSchema(document, schema.items, `${location}.items`);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    assertResponseSchema(
      document,
      schema.additionalProperties,
      `${location}.additionalProperties`,
    );
  }
  for (const [index, child] of (schema.allOf ?? []).entries()) {
    assertResponseSchema(document, child, `${location}.allOf[${index}]`);
  }
  for (const [index, child] of (schema.oneOf ?? []).entries()) {
    assertResponseSchema(document, child, `${location}.oneOf[${index}]`);
  }
}

function renderOperations(document, digest) {
  const seen = new Set();
  const entries = [];

  for (const [route, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || typeof operation !== 'object' || operation === null) continue;
      const operationId = operation.operationId;
      if (typeof operationId !== 'string' || operationId.length === 0) {
        throw new Error(`${method.toUpperCase()} ${route} is missing operationId`);
      }
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(operationId)) {
        throw new Error(`operationId is not a callable JavaScript property: ${operationId}`);
      }
      if (RESERVED_OPERATION_IDS.has(operationId)) {
        throw new Error(`operationId is reserved by the Admin client: ${operationId}`);
      }
      if (seen.has(operationId)) throw new Error(`Duplicate operationId: ${operationId}`);
      seen.add(operationId);

      const successStatuses = Object.keys(operation.responses ?? {})
        .map(Number)
        .filter((status) => status >= 200 && status < 300)
        .sort((left, right) => left - right);
      if (successStatuses.length === 0) {
        throw new Error(`${operationId} has no successful response`);
      }
      const responseSchemas = Object.fromEntries(
        successStatuses.map((status) => {
          const response = resolveLocalRef(document, operation.responses[String(status)]);
          const schema = response?.content?.['application/json']?.schema ?? null;
          return [status, schema];
        }),
      );

      entries.push(
        `  ${JSON.stringify(operationId)}: { method: ${JSON.stringify(method.toUpperCase())}, path: ${JSON.stringify(route)}, successStatuses: ${JSON.stringify(successStatuses)}, responseSchemas: ${JSON.stringify(responseSchemas)} },`,
      );
    }
  }

  return `/**
 * Generated from packages/auth-core/openapi/v1.json.
 * Do not edit directly. Run \`pnpm admin:generate\`.
 */

export const ADMIN_API_SPEC_SHA256 = ${JSON.stringify(digest)}; // gitleaks:allow - public contract checksum

export const adminOperations = {
${entries.join('\n')}
} as const;

export const adminComponentSchemas = ${JSON.stringify(document.components?.schemas ?? {})} as const;

export type AdminOperationId = keyof typeof adminOperations;
`;
}

function resolveLocalRef(document, value) {
  if (!value || typeof value !== 'object' || typeof value.$ref !== 'string') return value;
  if (!value.$ref.startsWith('#/')) {
    throw new Error(`External OpenAPI reference is unsupported: ${value.$ref}`);
  }
  let current = document;
  for (const encodedSegment of value.$ref.slice(2).split('/')) {
    const segment = encodedSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    current = current?.[segment];
  }
  if (!current || typeof current !== 'object') {
    throw new Error(`Unresolved OpenAPI reference: ${value.$ref}`);
  }
  return current;
}
