#!/usr/bin/env bash
# Install @authowl/convex from its tarball and verify runtime and type exports.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$root"

work="$(mktemp -d)"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/tgz" "$work/consumer"

if [[ -n "${AUTHOWL_PREPACKED_DIR:-}" ]]; then
  cp "$AUTHOWL_PREPACKED_DIR"/authowl-convex-*.tgz "$work/tgz/"
else
  pnpm --filter @authowl/convex build >/dev/null
  (cd packages/auth-convex && pnpm pack --pack-destination "$work/tgz" >/dev/null)
fi

convex_tgz="$(find "$work/tgz" -maxdepth 1 -name 'authowl-convex-*.tgz' -print -quit)"
if [[ -z "$convex_tgz" ]]; then
  echo 'convex-install-check: FAILED (tarball missing)' >&2
  exit 1
fi

files="$(tar -tzf "$convex_tgz")"
for required in \
  package/dist/index.js \
  package/dist/index.cjs \
  package/dist/index.d.ts \
  package/dist/index.d.cts \
  package/README.md \
  package/LICENSE \
  package/THIRD_PARTY_NOTICES.md; do
  printf '%s\n' "$files" | grep -qx "$required"
done
if printf '%s\n' "$files" | grep -Eq '(^|/)(src|test)/|\.map$'; then
  echo 'convex-install-check: FAILED (source, tests, or sourcemaps leaked)' >&2
  exit 1
fi

cat >"$work/consumer/package.json" <<JSON
{
  "name": "authowl-convex-install-check",
  "private": true,
  "type": "module",
  "dependencies": {
    "@authowl/convex": "file:$convex_tgz",
    "@types/react": "19.2.16",
    "convex": "1.42.1",
    "react": "19.2.7",
    "typescript": "5.9.3"
  }
}
JSON
npm install --prefix "$work/consumer" --ignore-scripts --no-audit --no-fund --silent

(
  cd "$work/consumer"
  node --input-type=module -e '
    const module = await import("@authowl/convex");
    if (typeof module.ConvexProviderWithAuthOwl !== "function") {
      throw new Error("ESM provider export is missing");
    }
  '
  node -e '
    const module = require("@authowl/convex");
    if (typeof module.ConvexProviderWithAuthOwl !== "function") {
      throw new Error("CommonJS provider export is missing");
    }
  '
)

cat >"$work/consumer/proof.tsx" <<'TS'
import type { ComponentProps } from 'react';
import { ConvexProviderWithAuthOwl } from '@authowl/convex';
import { ConvexReactClient } from 'convex/react';

type ProviderProps = ComponentProps<typeof ConvexProviderWithAuthOwl>;
declare const useAuth: ProviderProps['useAuth'];

const client = new ConvexReactClient('https://example.convex.cloud');
const proof = <ConvexProviderWithAuthOwl client={client} useAuth={useAuth}>child</ConvexProviderWithAuthOwl>;
void proof;
TS
cat >"$work/consumer/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "jsx": "react-jsx",
    "skipLibCheck": false
  },
  "include": ["proof.tsx"]
}
JSON
(cd "$work/consumer" && ./node_modules/.bin/tsc -p tsconfig.json)

echo 'convex-install-check: OK'
