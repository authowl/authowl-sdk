#!/usr/bin/env bash
# Install @authowl/tokens from its tarball, verify the runtime, type and CSS
# exports, and compile theme.css with real Tailwind 4 to prove the utilities
# it promises are generated from the token variables.
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
  cp "$AUTHOWL_PREPACKED_DIR"/authowl-tokens-*.tgz "$work/tgz/"
else
  pnpm --filter @authowl/tokens build >/dev/null
  (cd packages/tokens && pnpm pack --pack-destination "$work/tgz" >/dev/null)
fi

tokens_tgz="$(find "$work/tgz" -maxdepth 1 -name 'authowl-tokens-*.tgz' -print -quit)"
if [[ -z "$tokens_tgz" ]]; then
  echo 'tokens-install-check: FAILED (tarball missing)' >&2
  exit 1
fi

files="$(tar -tzf "$tokens_tgz")"
for required in \
  package/dist/index.js \
  package/dist/index.cjs \
  package/dist/index.d.ts \
  package/dist/index.d.cts \
  package/dist/tokens.css \
  package/dist/theme.css \
  package/dist/shadcn.css \
  package/README.md \
  package/LICENSE \
  package/THIRD_PARTY_NOTICES.md; do
  printf '%s\n' "$files" | grep -qx "$required"
done
if printf '%s\n' "$files" | grep -Eq '(^|/)(src|test|scripts)/|\.map$'; then
  echo 'tokens-install-check: FAILED (source, tests, scripts, or sourcemaps leaked)' >&2
  exit 1
fi

cat >"$work/consumer/package.json" <<JSON
{
  "name": "authowl-tokens-install-check",
  "private": true,
  "type": "module",
  "dependencies": {
    "@authowl/tokens": "file:$tokens_tgz",
    "@tailwindcss/cli": "4.3.3",
    "tailwindcss": "4.3.3",
    "typescript": "5.9.3"
  }
}
JSON
npm install --prefix "$work/consumer" --ignore-scripts --no-audit --no-fund --silent

(
  cd "$work/consumer"
  node --input-type=module -e '
    const tokens = await import("@authowl/tokens");
    if (tokens.cssVar("surface") !== "var(--ao-surface)") throw new Error("ESM cssVar is wrong");
    if (tokens.measureContrast().some((result) => !result.passes)) throw new Error("a shipped pairing fails AA");
  '
  node -e '
    const tokens = require("@authowl/tokens");
    if (typeof tokens.palette !== "function") throw new Error("CommonJS export is missing");
    const css = require("node:fs").readFileSync(require.resolve("@authowl/tokens/tokens.css"), "utf8");
    if (!css.includes("--ao-canvas:")) throw new Error("tokens.css does not resolve to the variables");
  '
)

cat >"$work/consumer/proof.ts" <<'TS'
import { cssVar, palette, toHex, type Brand, type ColorToken } from '@authowl/tokens';

const brand: Brand = 'billow';
const token: ColorToken = 'accent';
const fill: string = toHex(palette(brand, 'dark')[token]);
const style: string = cssVar('on-accent');
void [fill, style];
TS
cat >"$work/consumer/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "skipLibCheck": false
  },
  "include": ["proof.ts"]
}
JSON
(cd "$work/consumer" && ./node_modules/.bin/tsc -p tsconfig.json)

cat >"$work/consumer/app.css" <<'CSS'
@import "tailwindcss";
@import "@authowl/tokens/tokens.css";
@import "@authowl/tokens/theme.css";
CSS
cat >"$work/consumer/index.html" <<'HTML'
<div class="bg-surface text-fg-muted border-line rounded-card shadow-popover text-body p-4 bg-accent text-on-accent"></div>
HTML
(cd "$work/consumer" && ./node_modules/.bin/tailwindcss -i app.css -o out.css >/dev/null 2>&1)
# `@theme inline` makes each utility read the token variable directly, so the
# scheme and brand switch at runtime with no rebuild.
for rule in \
  'background-color: var(--ao-surface)' \
  'background-color: var(--ao-accent)' \
  'color: var(--ao-fg-muted)' \
  'color: var(--ao-on-accent)' \
  'border-radius: var(--ao-radius-card)' \
  'font-size: var(--ao-text-body)' \
  '--tw-shadow: var(--ao-shadow-popover)' \
  'padding: calc(var(--ao-space-unit) * 4)'; do
  if ! grep -qF -- "$rule" "$work/consumer/out.css"; then
    echo "tokens-install-check: FAILED (Tailwind 4 did not generate: $rule)" >&2
    exit 1
  fi
done

echo 'tokens-install-check: OK'
