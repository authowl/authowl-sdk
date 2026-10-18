#!/usr/bin/env bash
# Install @authowl/tokens from its tarball, verify the runtime, type and CSS
# exports, and compile a stock shadcn/ui globals.css with real Tailwind 4, as
# is and with the README's adoption applied, to prove the adoption keeps every
# utility and points each one at the tokens.
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
const token: ColorToken = 'brand';
const fill: string = toHex(palette(brand, 'dark')[token]);
const style: string = cssVar('on-brand');
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

# The stock file as shadcn generates it, and the README's adoption: its
# @theme block and colour blocks replaced by the three imports.
cp "$root/scripts/ci/fixtures/shadcn-globals.css" "$work/consumer/stock.css"
cat >"$work/consumer/adopted.css" <<'CSS'
@import "tailwindcss";
@import "@authowl/tokens/tokens.css";
@import "@authowl/tokens/theme.css";
@import "@authowl/tokens/shadcn.css";

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
CSS
cat >"$work/consumer/index.html" <<'HTML'
<div class="bg-background bg-card bg-popover bg-primary text-primary-foreground hover:bg-accent text-muted-foreground text-destructive border-input ring-ring/50 rounded-md rounded-xl shadow-sm shadow-md text-sm text-lg font-sans p-4 transition"></div>
<div class="text-success bg-primary-hover text-primary-text"></div>
HTML
for sheet in stock adopted; do
  (cd "$work/consumer" && ./node_modules/.bin/tailwindcss -i "$sheet.css" -o "$sheet-out.css" >/dev/null 2>&1)
done

# Adoption drops nothing a stock shadcn primitive uses.
for utility in \
  '.bg-background' '.bg-card' '.bg-popover' '.bg-primary' '.text-primary-foreground' \
  '.hover\:bg-accent' '.text-muted-foreground' '.text-destructive' '.border-input' \
  '.ring-ring\/50' '.rounded-md' '.rounded-xl' '.shadow-sm' '.shadow-md' '.text-sm' \
  '.text-lg' '.font-sans' '.p-4' '.transition'; do
  for sheet in stock adopted; do
    if ! grep -qF -- "$utility" "$work/consumer/$sheet-out.css"; then
      echo "tokens-install-check: FAILED ($sheet build has no $utility)" >&2
      exit 1
    fi
  done
done

# `@theme inline` makes each adopted utility read the token variable directly,
# so the scheme and brand switch at runtime with no rebuild.
for rule in \
  'background-color: var(--ao-canvas)' \
  'background-color: var(--ao-surface)' \
  'background-color: var(--ao-raised)' \
  'background-color: var(--ao-brand)' \
  'background-color: var(--ao-brand-hover)' \
  'background-color: var(--ao-highlight)' \
  'color: var(--ao-on-brand)' \
  'color: var(--ao-fg-muted)' \
  'color: var(--ao-danger)' \
  'color: var(--ao-success)' \
  'color: var(--ao-brand-text)' \
  'border-color: var(--ao-line-strong)' \
  'color-mix(in oklab, var(--ao-ring) 50%, transparent)' \
  'border-radius: var(--ao-radius-md)' \
  'border-radius: var(--ao-radius-xl)' \
  '--tw-shadow: 0 0 var(--tw-shadow-color, #0000)' \
  '--tw-shadow: var(--ao-shadow-popover)' \
  'font-size: var(--ao-text-sm)' \
  'line-height: var(--tw-leading, var(--ao-text-lg-line-height))' \
  'font-family: var(--ao-font-sans)' \
  'padding: calc(var(--spacing) * 4)' \
  'transition-duration: var(--tw-duration, var(--ao-duration-base))'; do
  if ! grep -qF -- "$rule" "$work/consumer/adopted-out.css"; then
    echo "tokens-install-check: FAILED (adopted build did not generate: $rule)" >&2
    exit 1
  fi
done
if [[ "$(grep -c '^  \.text-success {' "$work/consumer/adopted-out.css")" != 1 ]]; then
  echo 'tokens-install-check: FAILED (text-success is not defined exactly once)' >&2
  exit 1
fi

echo 'tokens-install-check: OK'
