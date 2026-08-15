/**
 * Derives `conformance/client-surface.json` from the TypeScript client.
 *
 * WHY THIS EXISTS
 *
 * AuthOwl has two APIs. The Admin API (`/api/v1/*`, secret-key) has an OpenAPI
 * document that CI pins by SHA. The CLIENT auth API - the ~60 publishable-key
 * routes an end-user app calls to sign in - has no specification at all. It
 * exists only as TypeScript in `packages/auth-core`.
 *
 * That is fine while every SDK is JavaScript, because they import that
 * TypeScript directly. It stops being fine the moment a Dart, Swift, or Kotlin
 * client has to talk to the same routes: each one would hand-transcribe sixty
 * endpoints from source, with nothing machine-checkable holding them in place
 * when the server moves.
 *
 * So this script extracts the surface the TypeScript actually calls and commits
 * it as an artifact other languages can generate from and test against. It is
 * a protocol contract rather than user documentation, and CI verifies that it
 * stays synchronized with the reference implementation.
 *
 * Usage:
 *   node scripts/generate-client-surface.mjs           # write the artifact
 *   node scripts/generate-client-surface.mjs --check   # fail if it has drifted
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'packages/auth-core/src');
const OUT = path.join(ROOT, 'conformance/client-surface.json');

/** Every module that issues a request against the project auth base URL. */
const SOURCES = [
  'native-client.ts',
  'account-client.ts',
  'organization-client.ts',
  'passkey-client.ts',
  'session-store.ts',
  'metadata-client.ts',
  'session-handoff.ts',
];

/**
 * Routes a non-browser client must not expose.
 *
 * The WebAuthn ceremonies need `navigator.credentials`, and the two redirect
 * flows finish inside a browser whose cookie jar a native app cannot reach -
 * the exact bug that made the first React Native social sign-in unable to
 * establish a session. Native social sign-in uses a provider ID token against
 * `/sign-in/social` instead, which is why that path stays native-safe.
 */
const BROWSER_ONLY = new Set([
  '/passkey/generate-authenticate-options',
  '/passkey/generate-register-options',
  '/passkey/verify-authentication',
  '/passkey/verify-registration',
  '/sign-in/sso',
  // The cross-site session handoff. `/session/start` is a NAVIGATION, not a
  // request, so it never appears in the generated surface at all; `/session/exchange`
  // does, and is browser-only for the same reason as the two flows above - it
  // exists to move a session out of a browser's auth-host cookie jar and into
  // the tenant's, which a native app has no equivalent of.
  '/session/exchange',
]);

/**
 * auth-core reaches the API two ways: the `post`/`get` action helpers, and
 * `http.request` directly where a call needs query parameters or post-processing.
 * Both are matched, because a contract that silently skipped the second shape
 * would omit `/get-session` and every passkey route - the drift guard has to see
 * the whole surface or it guards nothing.
 */
const CALL = /\b(post|get|request)\s*(?:<[^>]*>)?\s*\(\s*'(\/[a-zA-Z0-9/_-]+)'/g;
/**
 * Requires at least one character after `decode` so the option KEY (`decode:`)
 * is skipped and its VALUE (`decodeSessionData`) is captured. Also matches the
 * positional helper form and the inline `decode: (v) => decodeX(v, …)` wrapper.
 */
const DECODER = /\b(decode[A-Za-z0-9_]+)/;
const EXPLICIT_METHOD = /method:\s*'(GET|POST|PATCH|PUT|DELETE)'/;
const HAS_BODY = /\bbody:/;

/** `/sign-in/email` -> `signIn.email`; `/get-session` -> `getSession`. */
function operationId(route) {
  const segments = route.replace(/^\//, '').split('/');
  return segments
    .map((segment, index) => {
      const camel = segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
      return index === 0 ? camel : camel;
    })
    .join('.');
}

/**
 * The remaining arguments of the call that starts at `from`, found by balancing
 * parentheses rather than reading a fixed number of characters.
 *
 * A fixed window is silently wrong here: `/user/metadata` is fetched with a
 * three-line GET immediately above a PATCH to the same path, so a window wide
 * enough for a long options object also reaches the NEXT call and reads its
 * `method`. That mislabelled the GET as a PATCH, collapsed the two into one
 * entry, and dropped an endpoint from the contract - a hole the drift guard
 * could never report, because the artifact and the guard agreed with each other.
 */
function callArguments(source, from) {
  let depth = 1;
  let index = from;
  let quote = null;
  while (index < source.length && depth > 0) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    }
    index += 1;
  }
  return source.slice(from, Math.max(from, index - 1));
}

/**
 * The helpers fix the verb by name. `http.request` takes it from the options,
 * and when unset falls back to auth-core's own rule: a body implies POST,
 * otherwise GET (see `createAuthHttpClient`). Mirroring that rule here keeps the
 * artifact honest instead of guessing.
 */
function resolveMethod(verb, tail) {
  if (verb === 'post') return 'POST';
  if (verb === 'get') return 'GET';
  const explicit = EXPLICIT_METHOD.exec(tail);
  if (explicit) return explicit[1];
  return HAS_BODY.test(tail) ? 'POST' : 'GET';
}

async function collect() {
  const operations = new Map();

  for (const file of SOURCES) {
    const source = await readFile(path.join(SRC, file), 'utf8');
    for (const match of source.matchAll(CALL)) {
      const [, verb, route] = match;
      const tail = callArguments(source, match.index + match[0].length);
      const decoderMatch = DECODER.exec(tail);
      const method = resolveMethod(verb, tail);
      // Keyed by METHOD + path, not path alone. `/user/metadata` is both a GET
      // and a PATCH, and collapsing them dropped the GET from the contract
      // entirely - a hole the drift guard would then never notice.
      const key = `${method} ${route}`;
      const entry = {
        id: operationId(route),
        method,
        path: route,
        decoder: decoderMatch ? decoderMatch[1] : null,
        native: !BROWSER_ONLY.has(route),
        source: file,
      };
      // The same operation reached from two modules keeps the first sighting;
      // its decoder is identical by construction.
      if (!operations.has(key)) operations.set(key, entry);
    }
  }

  return [...operations.values()].sort((left, right) =>
    left.path === right.path
      ? left.method.localeCompare(right.method)
      : left.path.localeCompare(right.path));
}

const operations = await collect();
if (operations.length === 0) {
  throw new Error('client-surface: extracted no operations - the call shape in auth-core changed.');
}

const document = {
  $comment:
    'GENERATED by scripts/generate-client-surface.mjs - do not edit by hand. The INTERNAL '
    + 'contract for the publishable-key client auth API, so non-JavaScript SDKs can be '
    + 'generated and drift-checked against the same surface @authowl/core calls. Not '
    + 'published documentation.',
  generatedFrom: SOURCES,
  operationCount: operations.length,
  nativeOperationCount: operations.filter((operation) => operation.native).length,
  operations,
};

const serialized = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(OUT, 'utf8');
  } catch {
    console.error('client-surface: conformance/client-surface.json is missing. Run: node scripts/generate-client-surface.mjs');
    process.exit(1);
  }
  if (current !== serialized) {
    console.error(
      'client-surface: conformance/client-surface.json is stale.\n'
      + 'The client auth surface changed, which means every non-JavaScript SDK is now\n'
      + 'talking to routes the TypeScript client no longer matches.\n'
      + 'Run: node scripts/generate-client-surface.mjs',
    );
    process.exit(1);
  }
  console.log(`client-surface: up to date (${operations.length} operations).`);
} else {
  await writeFile(OUT, serialized);
  console.log(
    `client-surface: wrote ${operations.length} operations `
    + `(${document.nativeOperationCount} native-safe) to conformance/client-surface.json`,
  );
}
