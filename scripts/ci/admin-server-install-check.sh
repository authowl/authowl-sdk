#!/usr/bin/env bash
# Pack @authowl/core and exercise its server entrypoint from a clean consumer.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$root"

WORK="$(mktemp -d)"
MOCK_PID=""
cleanup() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/tgz" "$WORK/consumer"

if [ -n "${AUTHOWL_PREPACKED_DIR:-}" ]; then
  cp "$AUTHOWL_PREPACKED_DIR"/authowl-core-*.tgz "$WORK/tgz/"
else
  pnpm --filter @authowl/core build >/dev/null
  (cd packages/auth-core && pnpm pack --pack-destination "$WORK/tgz" >/dev/null)
fi
CORE_TGZ="$(find "$WORK/tgz" -maxdepth 1 -name 'authowl-core-*.tgz' -print -quit)"
if [ -z "$CORE_TGZ" ]; then
  echo "admin-server-install-check: FAILED (tarball missing)"
  exit 1
fi

files="$(tar -tzf "$CORE_TGZ")"
for required in package/dist/server.js package/dist/server.cjs package/dist/server.d.ts package/dist/server.d.cts; do
  printf '%s\n' "$files" | grep -qx "$required"
done
if printf '%s\n' "$files" | grep -Eq '(^|/)(src|test|openapi)/|\.map$'; then
  echo "admin-server-install-check: FAILED (source, tests, OpenAPI input, or sourcemaps leaked)"
  exit 1
fi
tar -xOf "$CORE_TGZ" package/package.json > "$WORK/core-package.json"
node -e '
  const pkg = require(process.argv[1]);
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    if (pkg[field]?.react || pkg[field]?.["react-dom"]) {
      throw new Error(`packed core retains a React dependency in ${field}`);
    }
  }
' "$WORK/core-package.json"

cat > "$WORK/consumer/package.json" <<JSON
{
  "name": "authowl-admin-server-install-check",
  "private": true,
  "type": "module",
  "dependencies": {
    "@authowl/core": "file:$CORE_TGZ",
    "esbuild": "0.28.1",
    "typescript": "5.9.3"
  }
}
JSON
npm install --prefix "$WORK/consumer" --legacy-peer-deps --no-audit --no-fund --silent
if [ -e "$WORK/consumer/node_modules/react" ] || [ -e "$WORK/consumer/node_modules/react-dom" ]; then
  echo "admin-server-install-check: FAILED (core-only install pulled a React runtime)"
  exit 1
fi

cat > "$WORK/mock-server.mjs" <<'JS'
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const secret = ['sk', 'test', '00000000-0000-4000-8000-000000000001', 'A'.repeat(32)].join('_');
let user = null;
let userMetadata = { public_metadata: {}, private_metadata: {}, unsafe_metadata: {}, metadata_version: 0 };
let sessionMetadata = { metadata: {}, metadata_version: 0 };

const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  response.setHeader('x-request-id', 'packed-proof-request');
  if (request.headers.authorization !== `Bearer ${secret}`) {
    response.writeHead(401, { 'content-type': 'application/problem+json' }).end(JSON.stringify({
      type: 'https://docs.authowl.dev/errors/invalid-secret-key',
      title: 'Invalid secret key',
      status: 401,
      detail: 'Provide an active AuthOwl secret key.',
      instance: 'urn:authowl:request:packed-proof-request',
      code: 'INVALID_SECRET_KEY',
    }));
    return;
  }

  const url = new URL(request.url, 'http://localhost');
  const body = await readJson(request);
  if (request.method === 'POST' && url.pathname === '/api/v1/users') {
    user = {
      id: 'user-packed-proof',
      email: body.email,
      phone: null,
      name: body.name ?? null,
      image: null,
      email_verified: false,
      banned: false,
      public_metadata: {},
      private_metadata: {},
      unsafe_metadata: {},
      metadata_version: 0,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    response.writeHead(201).end(JSON.stringify(user));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/users') {
    response.end(JSON.stringify({ data: user ? [user] : [], next_cursor: null }));
    return;
  }
  if (request.method === 'PATCH' && url.pathname === '/api/v1/users/user-packed-proof' && user) {
    user = { ...user, ...body };
    response.end(JSON.stringify(user));
    return;
  }
  if (request.method === 'PATCH' && url.pathname === '/api/v1/users/user-packed-proof/metadata' && user) {
    userMetadata = {
      public_metadata: body.public_metadata ?? userMetadata.public_metadata,
      private_metadata: body.private_metadata ?? userMetadata.private_metadata,
      unsafe_metadata: body.unsafe_metadata ?? userMetadata.unsafe_metadata,
      metadata_version: userMetadata.metadata_version + 1,
    };
    response.end(JSON.stringify(userMetadata));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/sessions/session-packed-proof') {
    response.end(JSON.stringify({
      id: 'session-packed-proof',
      user_id: 'user-packed-proof',
      expires_at: new Date(86_400_000).toISOString(),
      created_at: new Date(0).toISOString(),
      ip_address: null,
      user_agent: null,
      ...sessionMetadata,
    }));
    return;
  }
  if (request.method === 'PATCH' && url.pathname === '/api/v1/sessions/session-packed-proof') {
    sessionMetadata = {
      metadata: body.metadata,
      metadata_version: sessionMetadata.metadata_version + 1,
    };
    response.end(JSON.stringify(sessionMetadata));
    return;
  }
  if (request.method === 'DELETE' && url.pathname === '/api/v1/users/user-packed-proof') {
    user = null;
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server did not expose a port');
  writeFileSync(process.argv[2], String(address.port));
});

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
JS

node "$WORK/mock-server.mjs" "$WORK/mock-port" &
MOCK_PID="$!"
for _ in $(seq 1 100); do
  if [ -s "$WORK/mock-port" ]; then break; fi
  sleep 0.05
done
[ -s "$WORK/mock-port" ]

cat > "$WORK/consumer/proof.mjs" <<'JS'
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  ADMIN_API_SPEC_SHA256,
  AuthOwlAdminApiError,
  createAdminClient,
  verifyWebhook,
  verifyProjectToken,
} from '@authowl/core/server';
import * as core from '@authowl/core';

if (
  'createAdminClient' in core ||
  'verifyProjectToken' in core ||
  'verifyWebhook' in core
) {
  throw new Error('server-only helpers leaked through the root entrypoint');
}
const browserClient = core.createAuthOwlClient(core.resolveConfig({
  publishableKey: 'pk_test_00000000-0000-4000-8000-000000000001_AAAAAAAAAAAAAAAAAAAA',
  apiUrl: 'http://localhost:3010',
  fetch: async () => Response.json(null),
}));
if (
  typeof browserClient.sessionStore?.subscribe !== 'function'
  || typeof browserClient.sessionStore?.getSnapshot !== 'function'
) {
  throw new Error('framework-neutral session store is missing from packed core');
}

const webhookVerified = await verifyWebhook({
  rawBody: '{"id":"evt_1","type":"user.created"}',
  timestamp: '1700000000',
  signatureHeader: 'v1=cb50321336e047cf5457e46cdfe34f5e6e8581d74dd831382822816ffcaa622c',
  secrets: ['whsec_test_vector'],
  now: 1700000000,
});
if (!webhookVerified) throw new Error('packed webhook verifier rejected the canonical vector');

const secretKey = ['sk', 'test', '00000000-0000-4000-8000-000000000001', 'A'.repeat(32)].join('_');
const apiUrl = `http://127.0.0.1:${process.argv[2]}`;
const authowl = createAdminClient({ secretKey, apiUrl });
const created = await authowl.createUser({ body: { email: 'packed@example.com', name: 'Packed proof' } });
const page = await authowl.listUsers({ query: { limit: 10 } });
const updated = await authowl.updateUser({ path: { userId: created.id }, body: { name: 'Updated proof' } });
const userMetadata = await authowl.updateUserMetadata({
  path: { userId: created.id },
  body: { expected_version: 0, public_metadata: { locale: 'ar' }, private_metadata: { tier: 'gold' } },
});
const session = await authowl.getSession({ path: { sessionId: 'session-packed-proof' } });
const sessionMetadata = await authowl.updateSessionMetadata({
  path: { sessionId: session.id },
  body: { expected_version: session.metadata_version, metadata: { checkout: 'review' } },
});
await authowl.deleteUser({ path: { userId: created.id } });

if (
  page.data.length !== 1 ||
  updated.name !== 'Updated proof' ||
  userMetadata.private_metadata.tier !== 'gold' ||
  sessionMetadata.metadata.checkout !== 'review' ||
  !/^[a-f0-9]{64}$/.test(ADMIN_API_SPEC_SHA256)
) {
  throw new Error('packed Admin API client returned an unexpected contract');
}

const wrongKey = ['sk', 'test', '00000000-0000-4000-8000-000000000001', 'B'.repeat(32)].join('_');
const invalid = createAdminClient({ secretKey: wrongKey, apiUrl });
try {
  await invalid.listUsers();
  throw new Error('invalid secret key was accepted');
} catch (error) {
  if (!(error instanceof AuthOwlAdminApiError) || error.code !== 'INVALID_SECRET_KEY') throw error;
}

const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const kid = '88888888-8888-4888-8888-888888888888';
const issuer = 'https://issuer.example.com/custom';
const audience = 'packed-worker-proof';
const publicJwk = {
  ...pair.publicKey.export({ format: 'jwk' }),
  alg: 'ES256',
  kid,
  use: 'sig',
};
const encode = (value) => Buffer.from(value).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const protectedHeader = encode(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
const payload = encode(JSON.stringify({ sub: 'packed-user', iss: issuer, aud: audience, exp: now + 60 }));
const signingInput = `${protectedHeader}.${payload}`;
const signature = sign('sha256', Buffer.from(signingInput), {
  key: pair.privateKey,
  dsaEncoding: 'ieee-p1363',
}).toString('base64url');
globalThis.fetch = async (url, init) => {
  if (
    String(url) !== 'https://keys.example.net/v1/jwks'
    || init?.redirect !== 'error'
    || !(init?.signal instanceof AbortSignal)
  ) {
    throw new Error('packed verifier did not preserve its bounded transport contract');
  }
  return Response.json({ keys: [publicJwk] });
};
const verified = await verifyProjectToken(`${signingInput}.${signature}`, {
  issuer,
  jwksUri: 'https://keys.example.net/v1/jwks',
  audience,
});
if (verified.sub !== 'packed-user') {
  throw new Error('packed verifier returned an unexpected identity');
}

console.log('packed Admin API ESM proof OK');
JS

node "$WORK/consumer/proof.mjs" "$(cat "$WORK/mock-port")" > "$WORK/esm-output"
grep -qx 'packed Admin API ESM proof OK' "$WORK/esm-output"

(cd "$WORK/consumer" && node -e '
  const server = require("@authowl/core/server");
  const typed = new server.TokenVerificationError("typed", "JWKS_KEY_INVALID");
  if (
    typeof server.createAdminClient !== "function" ||
    typeof server.verifyProjectToken !== "function" ||
    typeof server.verifyWebhook !== "function" ||
    typeof server.ADMIN_API_SPEC_SHA256 !== "string" ||
    typed.code !== "JWKS_KEY_INVALID"
  ) {
    throw new Error("packed CommonJS server entrypoint is incomplete");
  }
')

cat > "$WORK/consumer/proof.ts" <<'TS'
import {
  createAdminClient,
  verifyWebhook,
  verifyToken,
  type AdminOperationResult,
  type TokenVerificationErrorCode,
  type VerifyTokenConfig,
  type VerifyWebhookInput,
} from '@authowl/core/server';

const secretKey = ['sk', 'test', '00000000-0000-4000-8000-000000000001', 'A'.repeat(32)].join('_');
const authowl = createAdminClient({ secretKey, apiUrl: 'http://localhost:3010' });
const users: Promise<AdminOperationResult<'listUsers'>> = authowl.listUsers({ query: { limit: 10 } });
void users;
void authowl.getUser({ path: { userId: 'user-1' } });
void authowl.updateUserMetadata({
  path: { userId: 'user-1' },
  body: { expected_version: 0, unsafe_metadata: { onboarding: true } },
});
void authowl.getSession({ path: { sessionId: 'session-1' } });
void authowl.updateSessionMetadata({
  path: { sessionId: 'session-1' },
  body: { expected_version: 0, metadata: { checkout: 'review' } },
});
// @ts-expect-error getUser requires generated path parameters.
void authowl.getUser();
// @ts-expect-error createUser requires its generated JSON body.
void authowl.createUser();

const derivedVerifier: VerifyTokenConfig = {
  publishableKey: 'pk_test_00000000-0000-4000-8000-000000000001_AAAAAAAAAAAAAAAAAAAA',
  apiUrl: 'http://localhost:3010',
};
const explicitVerifier: VerifyTokenConfig = {
  issuer: 'https://issuer.example.com/custom',
  jwksUri: 'https://keys.example.net/v1/jwks',
  audience: 'application',
};
const verifierCode: TokenVerificationErrorCode = 'JWKS_RESPONSE_TOO_LARGE';
void verifyToken('token', derivedVerifier);
void verifyToken('token', explicitVerifier);
void verifierCode;
const webhookInput: VerifyWebhookInput = {
  rawBody: new Uint8Array(),
  timestamp: '1700000000',
  signatureHeader: 'v1=0000000000000000000000000000000000000000000000000000000000000000',
  secrets: ['whsec_example'],
};
void verifyWebhook(webhookInput);
// @ts-expect-error derived and explicit verifier configuration cannot be mixed.
const mixedVerifier: VerifyTokenConfig = { ...derivedVerifier, ...explicitVerifier };
void mixedVerifier;
// @ts-expect-error the explicit verifier requires all three fields.
const partialVerifier: VerifyTokenConfig = { issuer: 'https://issuer.example.com/custom' };
void partialVerifier;
TS
cat > "$WORK/consumer/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["proof.ts"]
}
JSON
(cd "$WORK/consumer" && npx --no-install tsc -p tsconfig.json)

cat > "$WORK/consumer/worker.ts" <<'TS'
import { verifyProjectToken, verifyWebhook } from '@authowl/core/server';

export default {
  async fetch(request: Request): Promise<Response> {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    await verifyProjectToken(token, {
      issuer: 'https://issuer.example.com/custom',
      jwksUri: 'https://keys.example.net/v1/jwks',
      audience: 'worker',
    });
    await verifyWebhook({
      rawBody: new Uint8Array(),
      timestamp: '1700000000',
      signatureHeader: 'v1=0000000000000000000000000000000000000000000000000000000000000000',
      secrets: ['whsec_example'],
      now: 1700000301,
    });
    return new Response('ok');
  },
};
TS
(cd "$WORK/consumer" && npx --no-install esbuild worker.ts \
  --bundle \
  --format=esm \
  --log-level=error \
  --outfile=worker.mjs \
  --platform=browser)
if grep -Eq 'node:|require\(' "$WORK/consumer/worker.mjs"; then
  echo "admin-server-install-check: FAILED (worker verifier bundle contains a Node-only import)"
  exit 1
fi

echo "admin-server-install-check: OK (React-free core, packed ESM/CJS/types/worker, bounded token and webhook verification, auth, user lifecycle, and metadata)"
