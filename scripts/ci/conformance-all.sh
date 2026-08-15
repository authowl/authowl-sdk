#!/usr/bin/env bash
#
# Runs the shared conformance corpus (conformance/vectors) against every AuthOwl
# SDK whose toolchain is available.
#
# A missing toolchain SKIPS that SDK locally so a contributor without, say, PHP
# can still run this. CI must NOT rely on that: set AUTHOWL_CONFORMANCE_STRICT=1
# there, which turns every skip into a failure. Otherwise a broken CI image would
# quietly reduce this gate to "the languages that happened to be installed".
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STRICT="${AUTHOWL_CONFORMANCE_STRICT:-0}"
FAILED=()
SKIPPED=()
PASSED=()

run_sdk() {
  local name="$1" tool="$2" dir="$3"
  shift 3

  if ! command -v "$tool" >/dev/null 2>&1; then
    if [ "$STRICT" = "1" ]; then
      echo "::error::$name: '$tool' is not installed, and strict mode forbids skipping."
      FAILED+=("$name (missing $tool)")
    else
      echo "--- $name: SKIPPED ('$tool' not installed)"
      SKIPPED+=("$name")
    fi
    return
  fi

  echo "--- $name: running"
  if (cd "$dir" && "$@"); then
    PASSED+=("$name")
  else
    echo "::error::$name conformance suite FAILED"
    FAILED+=("$name")
  fi
}

# The reference implementation. Every vector was derived from its semantics, so
# if this one fails the corpus itself is suspect.
run_sdk "TypeScript (@authowl/core)" pnpm . \
  pnpm --filter @authowl/core exec vitest run src/conformance.test.ts

run_sdk "Go" go sdks/go go test ./...

if [ -x .venv-authowl/bin/python ]; then
  run_sdk "Python" .venv-authowl/bin/python sdks/python \
    ../../.venv-authowl/bin/python -m pytest -q
else
  run_sdk "Python" python3 sdks/python python3 -m pytest -q
fi

run_sdk "PHP" php sdks/php ./vendor/bin/phpunit --no-coverage
run_sdk "Rust" cargo sdks/rust cargo test --quiet
# Runs the corpus for the two primitives this client SDK implements
# (cookie-name, publishable-key), plus the widget suite - the only place the
# generated catalog's emitted strings are exercised end to end.
run_sdk "Flutter" flutter sdks/flutter flutter test

echo
echo "==================== conformance summary ===================="
for sdk in "${PASSED[@]:-}"; do [ -n "$sdk" ] && echo "  PASS  $sdk"; done
for sdk in "${SKIPPED[@]:-}"; do [ -n "$sdk" ] && echo "  SKIP  $sdk"; done
for sdk in "${FAILED[@]:-}"; do [ -n "$sdk" ] && echo "  FAIL  $sdk"; done
echo "============================================================="

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "One or more SDKs disagree with conformance/vectors. Fix the SDK, not the vector."
  exit 1
fi
if [ "${#SKIPPED[@]}" -gt 0 ] && [ "$STRICT" = "1" ]; then
  exit 1
fi
echo "All available SDKs agree with the shared corpus."
