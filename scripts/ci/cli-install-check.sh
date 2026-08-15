#!/usr/bin/env bash
# Pack and install the public `authowl` CLI exactly as an npm consumer does.
# Run after `pnpm build` so the tarball contains the current dist output.
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
mkdir -p "$WORK/tgz" "$WORK/consumer" "$WORK/app/src/app"

if [ -n "${AUTHOWL_PREPACKED_DIR:-}" ]; then
  cp "$AUTHOWL_PREPACKED_DIR"/authowl-[0-9]*.tgz "$WORK/tgz/"
else
  (cd packages/cli && pnpm pack --pack-destination "$WORK/tgz" >/dev/null)
fi
CLI_TGZ="$(find "$WORK/tgz" -maxdepth 1 -name 'authowl-[0-9]*.tgz' -print -quit)"
if [ -z "$CLI_TGZ" ]; then
  echo "cli-install-check: FAILED (tarball missing)"
  exit 1
fi

files="$(tar -tzf "$CLI_TGZ")"
printf '%s\n' "$files" | grep -qx 'package/THIRD_PARTY_NOTICES.md'
if printf '%s\n' "$files" | grep -Eq '(^|/)(src|test)/|\.map$'; then
  echo "cli-install-check: FAILED (source, tests, or sourcemaps leaked into tarball)"
  exit 1
fi

cat > "$WORK/consumer/package.json" <<'JSON'
{"name":"authowl-cli-install-check","private":true}
JSON
npm install --prefix "$WORK/consumer" --no-audit --no-fund --silent "$CLI_TGZ"
CLI="$WORK/consumer/node_modules/.bin/authowl"
EXPECTED_VERSION="$(
  node -p "require('$WORK/consumer/node_modules/authowl/package.json').version"
)"
[ "$($CLI --version)" = "$EXPECTED_VERSION" ]
$CLI --help | grep -q 'AuthOwl CLI'
$CLI init --help | grep -q -- '--undo'
for command in whoami projects keys docs; do
  $CLI --help | grep -q "  $command"
done
$CLI docs --no-open | grep -q '^AuthOwl docs: https://authowl.dev$'

cat > "$WORK/mock-server.mjs" <<'JS'
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const token = `aoc_${"t".repeat(43)}`;
const projectId = "11111111-1111-4111-8111-111111111111";
const secretKey = `sk_test_${projectId}_${"S".repeat(32)}`;
const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (
    request.method === "POST" &&
    request.url === "/api/v1/imports/dry-run"
  ) {
    if (request.headers.authorization !== `Bearer ${secretKey}`) {
      response.writeHead(401).end(JSON.stringify({
        detail: "invalid secret key",
        code: "INVALID_SECRET_KEY",
      }));
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const records = body.split("\n").filter(Boolean).map(JSON.parse);
      const provider = records[0]?.source?.provider;
      const validClerk =
        provider === "clerk" &&
        records[1]?.external_id === "user_packed_001" &&
        records[1]?.email === "packed@example.test" &&
        records[1]?.primary_email_address === undefined &&
        records[1]?.password?.scheme === "bcrypt";
      const validFirebase =
        provider === "firebase" &&
        records[1]?.external_id === "firebase_packed_001" &&
        records[1]?.email === "firebase-packed@example.test" &&
        records[1]?.password?.scheme === "firebase-scrypt" &&
        records[1]?.password?.parameters?.mem_cost === 14 &&
        records[1]?.password?.parameters?.rounds === 8;
      if (
        records.length !== 2 ||
        records[0]?.schema_version !== "authowl.user-import.v1" ||
        (!validClerk && !validFirebase)
      ) {
        response.writeHead(422).end(JSON.stringify({
          detail: "unexpected canonical import",
          code: "IMPORT_VALIDATION_FAILED",
        }));
        return;
      }
      response.writeHead(201).end(JSON.stringify({
        id: "66666666-6666-4666-8666-666666666666",
        mode: "dry_run",
        status: "validated",
        schema_version: "authowl.user-import.v1",
        source: records[0].source,
        counts: { total: 1, valid: 1, invalid: 0 },
        bytes_received: Buffer.byteLength(body),
        errors_truncated: false,
        errors: [],
        created_at: "2026-07-16T10:00:00.000Z",
        completed_at: "2026-07-16T10:00:00.000Z",
      }));
    });
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end(JSON.stringify({ error: "invalid_token" }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/cli/me") {
    response.end(JSON.stringify({
      user: { id: "22222222-2222-4222-8222-222222222222", email: "owner@example.com" },
      workspace: { id: "33333333-3333-4333-8333-333333333333", name: "Cairo Shop" },
    }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/cli/projects") {
    response.end(JSON.stringify({ projects: [{
      id: projectId,
      application_id: "55555555-5555-4555-8555-555555555555",
      environment_type: "development",
      auth_base_url: `http://${request.headers.host}/api/projects/${projectId}/auth`,
      name: "Next Fixture",
      slug: "next-fixture",
      allowed_origins: ["http://localhost:3000"],
      auth_methods: ["password"],
      first_end_user_session_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
    }] }));
    return;
  }
  if (request.method === "GET" && request.url === `/api/cli/projects/${projectId}/publishable-keys`) {
    response.end(JSON.stringify({ keys: [{
      id: "44444444-4444-4444-8444-444444444444",
      name: "Next local",
      prefix: "pk_live",
      last4: "Ab29",
      created_at: "2026-07-14T00:10:00.000Z",
      last_used_at: null,
    }] }));
    return;
  }
  response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing mock address");
  writeFileSync(process.argv[2], String(address.port));
});
JS

node "$WORK/mock-server.mjs" "$WORK/mock-port" &
MOCK_PID="$!"
for _ in $(seq 1 100); do
  if [ -s "$WORK/mock-port" ]; then break; fi
  sleep 0.05
done
[ -s "$WORK/mock-port" ]
API_URL="http://127.0.0.1:$(cat "$WORK/mock-port")"
mkdir -p "$WORK/config"
node -e '
  const fs = require("fs");
  const now = new Date();
  fs.writeFileSync(process.argv[1], JSON.stringify({
    apiUrl: process.argv[2],
    accessToken: `aoc_${"t".repeat(43)}`,
    scopes: ["projects:read", "projects:create", "keys:publishable:issue"],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  }));
' "$WORK/config/credentials.json" "$API_URL"

AUTHOWL_CONFIG_HOME="$WORK/config" $CLI whoami --json > "$WORK/whoami.json"
AUTHOWL_CONFIG_HOME="$WORK/config" $CLI projects --json > "$WORK/projects.json"
AUTHOWL_CONFIG_HOME="$WORK/config" $CLI keys --project-id \
  11111111-1111-4111-8111-111111111111 --json > "$WORK/keys.json"
node -e '
  const fs = require("fs");
  const identity = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const projects = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const keys = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  if (
    identity.user.email !== "owner@example.com" ||
    projects.projects.length !== 1 ||
    projects.projects[0].environmentType !== "development" ||
    projects.projects[0].applicationId !== "55555555-5555-4555-8555-555555555555" ||
    keys.keys[0].last4 !== "Ab29"
  ) {
    throw new Error("packed CLI account commands returned an unexpected contract");
  }
  const output = [identity, projects, keys].map(JSON.stringify).join("\n");
  if (output.includes("aoc_") || output.includes("pk_live_11111111")) {
    throw new Error("packed CLI account commands exposed a credential");
  }
' "$WORK/whoami.json" "$WORK/projects.json" "$WORK/keys.json"

cat > "$WORK/clerk-users.csv" <<'CSV'
id,first_name,last_name,username,primary_email_address,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher
# nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash - public test hash
user_packed_001,Packed,User,,packed@example.test,,packed@example.test,,,,,$2b$10$U4C0ZY8OG8y41F9LusfKyu3HRMBL0rCZcKBVsXhgr.n8Ou6FPhzO2,bcrypt
CSV
AUTHOWL_SECRET_KEY="sk_test_11111111-1111-4111-8111-111111111111_SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS" \
  $CLI import "$WORK/clerk-users.csv" \
  --from clerk \
  --project 11111111-1111-4111-8111-111111111111 \
  --source-namespace packed_instance \
  --api-url "$API_URL" \
  --dry-run \
  --json > "$WORK/import.json"
node -e '
  const fs = require("fs");
  const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (
    result.mode !== "dry_run" ||
    result.source.provider !== "clerk" ||
    result.counts.total !== 1 ||
    result.counts.valid !== 1
  ) {
    throw new Error("packed CLI import returned an unexpected contract");
  }
' "$WORK/import.json"

cat > "$WORK/firebase-users.json" <<'JSON'
{"users":[{"localId":"firebase_packed_001","email":"firebase-packed@example.test","emailVerified":true,"passwordHash":"lSrfV15cpx95/sZS2W9c9Kp6i/LVgQNDNC/qzrCnh1SAyZvqmZqAjTdn3aoItz+VHjoZilo78198JAdRuid5lQ==","salt":"42xEC+ixf3L2lw=="}]}
JSON
cat > "$WORK/firebase-hash-config.json" <<'JSON'
{"hash_config":{"algorithm":"SCRYPT","base64_signer_key":"jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH0uiiTvC8pVMXAn210wjLNmdZJzxUECKbm0QsEmYUSDzZvpjeJ9WmXA==","base64_salt_separator":"Bw==","rounds":8,"mem_cost":14}}
JSON
AUTHOWL_SECRET_KEY="sk_test_11111111-1111-4111-8111-111111111111_SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS" \
  $CLI import "$WORK/firebase-users.json" \
  --from firebase \
  --firebase-hash-config "$WORK/firebase-hash-config.json" \
  --project 11111111-1111-4111-8111-111111111111 \
  --source-namespace packed_firebase_project \
  --api-url "$API_URL" \
  --dry-run \
  --json > "$WORK/firebase-import.json"
node -e '
  const fs = require("fs");
  const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (
    result.mode !== "dry_run" ||
    result.source.provider !== "firebase" ||
    result.counts.total !== 1 ||
    result.counts.valid !== 1
  ) {
    throw new Error("packed CLI Firebase import returned an unexpected contract");
  }
' "$WORK/firebase-import.json"

cat > "$WORK/app/package.json" <<'JSON'
{"packageManager":"pnpm@9.15.0","dependencies":{"next":"15.5.0","react":"19.0.0"}}
JSON
cat > "$WORK/app/tsconfig.json" <<'JSON'
{}
JSON
cat > "$WORK/app/pnpm-lock.yaml" <<'YAML'
lockfileVersion: '9.0'
YAML
cat > "$WORK/app/src/app/layout.tsx" <<'TSX'
export default function Layout({ children }) { return children; }
TSX

$CLI detect --cwd "$WORK/app" --json > "$WORK/detection.json"
node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (value.framework !== "next-app" || value.packageManager !== "pnpm" || !value.safeToGenerate) {
    throw new Error("packed CLI detector returned an unexpected contract");
  }
' "$WORK/detection.json"

echo "cli-install-check: OK (tarball, executable, account commands, Clerk/Firebase canonical imports, init help, docs, and detector contract)"
