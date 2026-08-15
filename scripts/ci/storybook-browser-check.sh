#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$root"

run_story() {
  local project="$1"
  local story="$2"
  local attempt=1
  local max_attempts=2
  local run_log
  local status

  while ((attempt <= max_attempts)); do
    run_log="$(mktemp "${TMPDIR:-/tmp}/authowl-storybook.XXXXXXXX")"
    set +e
    pnpm exec vitest run \
      --browser.fileParallelism=false \
      --config vitest.storybook.config.ts \
      --project="$project" \
      "$story" 2>&1 | tee "$run_log"
    status="${PIPESTATUS[0]}"
    set -e

    if ((status == 0)); then
      rm -f "$run_log"
      return 0
    fi

    if ((attempt >= max_attempts)) ||
      ! grep -Eq 'Browser connection was closed while running tests|\[birpc\] rpc is closed' "$run_log"; then
      rm -f "$run_log"
      return "$status"
    fi

    printf 'storybook-browser-check: transient browser transport failure; retrying %s %s (%d/%d)\n' \
      "$project" "$story" "$((attempt + 1))" "$max_attempts" >&2
    rm -f "$run_log"
    attempt=$((attempt + 1))
  done
}

for project in \
  storybook-en-light \
  storybook-en-dark \
  storybook-ar-light \
  storybook-ar-dark; do
  printf 'storybook-browser-check: %s\n' "$project"
  for story in stories/*.stories.tsx; do
    run_story "$project" "$story"
  done
done
