#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
gate="${script_dir}/semgrep-check.sh"
tmp_parent="${TMPDIR:-/tmp}"
fixture_root="$(mktemp -d "${tmp_parent%/}/authowl-semgrep-preflight.XXXXXX")"

cleanup() {
  if [[ -n "${fixture_root}" &&
        -d "${fixture_root}" &&
        "$(basename "${fixture_root}")" == authowl-semgrep-preflight.* ]]; then
    rm -rf -- "${fixture_root}"
  fi
}
trap cleanup EXIT

git -C "${fixture_root}" init -q
git -C "${fixture_root}" config user.email 'ci@authowl.local'
git -C "${fixture_root}" config user.name 'AuthOwl CI'
mkdir -p "${fixture_root}/src"
printf '%s\n' 'export const baseline = true;' > "${fixture_root}/src/index.ts"
git -C "${fixture_root}" add src/index.ts

run_preflight() {
  (
    cd "${fixture_root}"
    bash "${gate}" --preflight-only
  )
}

expect_rejected() {
  local description="$1"
  local expected_message="$2"
  local output
  local result

  set +e
  output="$(run_preflight 2>&1)"
  result=$?
  set -e

  if ((result == 0)); then
    printf 'semgrep-preflight-test: expected rejection for %s\n' \
      "${description}" >&2
    exit 1
  fi
  if ! grep -Fq "${expected_message}" <<<"${output}"; then
    printf 'semgrep-preflight-test: wrong rejection for %s\n%s\n' \
      "${description}" "${output}" >&2
    exit 1
  fi
}

run_preflight

printf '%s\n' 'tests/' > "${fixture_root}/.semgrepignore"
git -C "${fixture_root}" add .semgrepignore
expect_rejected 'repository ignore file' 'repository ignore files are forbidden'
git -C "${fixture_root}" rm -qf .semgrepignore

suppression_marker='nose''m'
printf '// %s\n' "${suppression_marker}" \
  > "${fixture_root}/src/unauthorized-suppression.ts"
git -C "${fixture_root}" add src/unauthorized-suppression.ts
expect_rejected 'unauthorized suppression' 'inline suppression inventory changed'
git -C "${fixture_root}" rm -qf src/unauthorized-suppression.ts

dd if=/dev/zero of="${fixture_root}/src/oversize.ts" \
  bs=1 count=0 seek=5000001 2>/dev/null
git -C "${fixture_root}" add src/oversize.ts
expect_rejected 'oversized target' 'target exceeds 5000000 bytes'
git -C "${fixture_root}" rm -qf src/oversize.ts

ln -s index.ts "${fixture_root}/src/symbolic-link.ts"
git -C "${fixture_root}" add src/symbolic-link.ts
expect_rejected 'symbolic link' 'symbolic links are forbidden'
git -C "${fixture_root}" rm -qf src/symbolic-link.ts

mkdir -p "${fixture_root}/nested-repository"
git -C "${fixture_root}/nested-repository" init -q
printf '%s\n' 'export const nested = true;' \
  > "${fixture_root}/nested-repository/source.ts"
git -C "${fixture_root}/nested-repository" add source.ts
expect_rejected 'untracked nested repository' 'non-regular scan entries are forbidden'
rm -rf -- "${fixture_root}/nested-repository"

mkdir -p "${fixture_root}/tracked-gitlink"
git -C "${fixture_root}/tracked-gitlink" init -q
git -C "${fixture_root}/tracked-gitlink" config user.email 'ci@authowl.local'
git -C "${fixture_root}/tracked-gitlink" config user.name 'AuthOwl CI'
printf '%s\n' 'export const gitlink = true;' \
  > "${fixture_root}/tracked-gitlink/source.ts"
git -C "${fixture_root}/tracked-gitlink" add source.ts
git -C "${fixture_root}/tracked-gitlink" commit -qm 'fixture'
git -C "${fixture_root}" -c advice.addEmbeddedRepo=false add tracked-gitlink 2>/dev/null
expect_rejected 'tracked gitlink' 'gitlinks are forbidden'
git -C "${fixture_root}" update-index --force-remove tracked-gitlink
rm -rf -- "${fixture_root}/tracked-gitlink"

run_preflight
echo 'semgrep-preflight-test: all fail-closed checks passed.'
