#!/usr/bin/env bash
set -euo pipefail

root=${AUTHOWL_CI_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}
test_root=$(mktemp -d "${TMPDIR:-/tmp}/authowl-sdk-ci-preflight.XXXXXXXX")
: "${AUTHOWL_CI_IMAGE:?local gate must supply its pinned SDK image}"
owned_volume=''
other_volume=''
ambiguous_volume_one=''
ambiguous_volume_two=''
owned_image=''
ambiguous_image=''
image_container=''
readonly resource_owner="sdk-preflight-owner-${test_root##*.}"
readonly resource_other="sdk-preflight-other-${test_root##*.}"

# shellcheck source=scripts/ci/docker-resource-ownership.sh
# shellcheck disable=SC1091
source "$root/scripts/ci/docker-resource-ownership.sh"

cleanup() {
  local body_status=$?
  local volume_name
  local actual_owner
  trap - EXIT INT TERM
  set +e
  for volume_name in \
    "$owned_volume" \
    "$other_volume" \
    "$ambiguous_volume_one" \
    "$ambiguous_volume_two"; do
    if [[ -n "$volume_name" ]]; then
      if ! actual_owner=$(
        docker volume inspect --format \
          "{{ index .Labels \"${AUTHOWL_SDK_CI_RUN_LABEL}\" }}" \
          "$volume_name" 2>/dev/null
      ); then
        body_status=1
        continue
      fi
      if [[ -z "$actual_owner" ]]; then
        body_status=1
        continue
      fi
      sdk_ci_remove_volume "$volume_name" "$actual_owner" ||
        body_status=1
    fi
  done
  if [[ -n "$image_container" ]]; then
    docker rm -f "$image_container" >/dev/null || body_status=1
  fi
  if [[ -n "$owned_image" ]]; then
    sdk_ci_remove_image "$owned_image" "$resource_owner" ||
      body_status=1
  fi
  if [[ -n "$ambiguous_image" ]]; then
    sdk_ci_remove_image "$ambiguous_image" "$resource_owner" ||
      body_status=1
  fi
  rm -rf "$test_root" || {
    if [[ "$body_status" -eq 0 ]]; then body_status=1; fi
  }
  exit "$body_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

expect_failure() {
  local fixture=$1
  local expected=$2
  shift 2
  if "$@" >"$test_root/$fixture.output" 2>&1; then
    echo "SDK local-gate preflight unexpectedly passed: $fixture" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$test_root/$fixture.output"; then
    echo "SDK local-gate preflight returned the wrong error: $fixture" >&2
    sed -n '1,20p' "$test_root/$fixture.output" >&2
    exit 1
  fi
}

snapshot_source() {
  local source_directory=$1
  local snapshot_mode=${2:-authored}
  docker run --rm \
    --network none \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 1g \
    --cpus 1 \
    --pids-limit 128 \
    --mount "type=bind,src=$source_directory,dst=/fixture,readonly" \
    --mount "type=bind,src=$root/scripts/ci/snapshot-source.mjs,dst=/ci/snapshot-source.mjs,readonly" \
    "$AUTHOWL_CI_IMAGE" node /ci/snapshot-source.mjs \
      /fixture "$snapshot_mode"
}

load_toolchain_fixture() (
  local fixture=$1
  # shellcheck source=scripts/ci/toolchain-contract.sh
  source "$root/scripts/ci/toolchain-contract.sh"
  sdk_ci_load_toolchain "$fixture"
)

verify_export_fixture() {
  docker run --rm \
    --network none \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 1g \
    --cpus 1 \
    --pids-limit 128 \
    --mount "type=bind,src=$test_root/export-fixture,dst=/fixture,readonly" \
    --mount "type=bind,src=$root/scripts/ci/verify-source-export.mjs,dst=/ci/verify-source-export.mjs,readonly" \
    "$AUTHOWL_CI_IMAGE" node /ci/verify-source-export.mjs \
      /fixture/export /fixture/tree "$export_object_format"
}

reset_export_fixture() {
  find "$test_root/export-fixture/export" -mindepth 1 -depth -delete
  GIT_NO_REPLACE_OBJECTS=1 \
    git -C "$test_root/export-fixture/repository" \
      archive --format=tar HEAD |
    tar -xf - -C "$test_root/export-fixture/export"
}

expect_export_rejected() {
  local fixture=$1
  local expected=$2
  if verify_export_fixture \
    >"$test_root/export-$fixture.output" 2>&1; then
    echo "SDK source export verifier accepted: $fixture" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$test_root/export-$fixture.output"; then
    echo "SDK source export verifier returned the wrong error: $fixture" >&2
    exit 1
  fi
}

git clone --quiet --no-local "$root" "$test_root/dirty"
printf '\n' >>"$test_root/dirty/package.json"
expect_failure dirty 'requires a clean worktree' \
  bash "$test_root/dirty/scripts/ci/local-gate.sh"

git clone --quiet --depth 1 "file://$root" "$test_root/shallow"
expect_failure shallow 'full Git history is required' \
  bash "$test_root/shallow/scripts/ci/local-gate.sh"

git clone --quiet --no-local "$root" "$test_root/gitlink"
(
  cd "$test_root/gitlink"
  git config user.email ci-fixture@invalid.local
  git config user.name 'CI fixture'
  git update-index --add --cacheinfo "160000,$(git rev-parse HEAD),fixture-submodule"
  git commit --quiet -m 'test fixture: add gitlink'
)
expect_failure gitlink 'Git submodules are not supported' \
  bash "$test_root/gitlink/scripts/ci/local-gate.sh"

git clone --quiet --no-local "$root" "$test_root/runtime"
(
  cd "$test_root/runtime"
  git config user.email ci-fixture@invalid.local
  git config user.name 'CI fixture'
  printf '21.0.0\n' >.nvmrc
  git add .nvmrc
  git commit --quiet -m 'test fixture: change runtime'
)
expect_failure runtime '.nvmrc must match the pinned Linux runtime' \
  bash "$test_root/runtime/scripts/ci/local-gate.sh"

git clone --quiet --no-local "$root" "$test_root/archive-attribute"
(
  cd "$test_root/archive-attribute"
  git config user.email ci-fixture@invalid.local
  git config user.name 'CI fixture'
  printf 'security assertion\n' >security.test.ts
  printf 'security.test.ts export-ignore\n' >.gitattributes
  git add .gitattributes security.test.ts
  git commit --quiet -m 'test fixture: hide security test from archive'
)
expect_failure archive-attribute 'archive-transforming attribute is forbidden' \
  bash "$test_root/archive-attribute/scripts/ci/local-gate.sh"

expect_failure arguments 'arguments are not supported' \
  bash "$root/scripts/ci/local-gate.sh" unexpected

pack_fixture="$test_root/pack"
mkdir -p "$pack_fixture/package" "$pack_fixture/tgz"
printf '%s\n' \
  '{"name":"authowl-pack-fixture","version":"1.0.0","scripts":{"prepack":"touch lifecycle-ran"}}' \
  >"$pack_fixture/package/package.json"
printf 'fixture\n' >"$pack_fixture/package/index.js"
docker run --rm \
  --network none \
  --read-only \
  --user "$(id -u):$(id -g)" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 1g \
  --cpus 1 \
  --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --mount "type=bind,src=$pack_fixture/package,dst=/package" \
  --mount "type=bind,src=$pack_fixture/tgz,dst=/tgz" \
  --workdir /package \
  --env HOME=/tmp \
  --env npm_config_ignore_scripts=true \
  "$AUTHOWL_CI_IMAGE" \
  pnpm pack --pack-destination /tgz >/dev/null
if [[ ! -f "$pack_fixture/tgz/authowl-pack-fixture-1.0.0.tgz" ]]; then
  echo 'SDK local-gate preflight did not create the expected package' >&2
  exit 1
fi
if [[ -e "$pack_fixture/package/lifecycle-ran" ]]; then
  echo 'SDK local-gate preflight ran a disabled package lifecycle' >&2
  exit 1
fi

toolchain_fixtures="$test_root/toolchain"
mkdir -p "$toolchain_fixtures"
cp "$root/docker/ci-toolchain.env" "$toolchain_fixtures/valid.env"
load_toolchain_fixture "$toolchain_fixtures/valid.env"
{
  cat "$toolchain_fixtures/valid.env"
  sed -n '1p' "$toolchain_fixtures/valid.env"
} >"$toolchain_fixtures/duplicate.env"
grep -v '^NODE_VERSION=' "$toolchain_fixtures/valid.env" \
  >"$toolchain_fixtures/missing.env"
{
  cat "$toolchain_fixtures/valid.env"
  printf 'UNKNOWN_PIN=value\n'
} >"$toolchain_fixtures/unknown.env"
{
  cat "$toolchain_fixtures/valid.env"
  printf 'MALFORMED\n'
} >"$toolchain_fixtures/malformed.env"
sed \
  's/^PNPM_VERSION=.*/PNPM_VERSION=/' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/empty.env"
sed \
  's#^NODE_BASE_IMAGE=.*#NODE_BASE_IMAGE=node@sha256:abc#' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/node-image.env"
sed \
  's#^PLAYWRIGHT_BASE_IMAGE=.*#PLAYWRIGHT_BASE_IMAGE=playwright@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/playwright-image.env"
sed \
  's#^GITLEAKS_IMAGE=.*#GITLEAKS_IMAGE=ghcr.io/gitleaks/gitleaks@sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/gitleaks-image.env"
sed \
  's/^NODE_VERSION=.*/NODE_VERSION=20.19.0/' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/node-version.env"
sed \
  's/^PNPM_VERSION=.*/PNPM_VERSION=10.34/' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/pnpm-version.env"
sed \
  's/^PNPM_INTEGRITY=.*/PNPM_INTEGRITY=sha512-invalid/' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/pnpm-integrity.env"
sed \
  's/^PNPM_INTEGRITY=.*/PNPM_INTEGRITY=sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/' \
  "$toolchain_fixtures/valid.env" >"$toolchain_fixtures/pnpm-padding.env"

while IFS='|' read -r fixture expected; do
  expect_failure "toolchain-$fixture" "$expected" \
    load_toolchain_fixture "$toolchain_fixtures/$fixture.env"
done <<'TOOLCHAIN_FAILURES'
duplicate|duplicate toolchain contract key
missing|invalid Node version pin
unknown|unknown toolchain contract key
malformed|malformed toolchain contract entry
empty|malformed toolchain contract entry
node-image|invalid Node image pin
playwright-image|invalid Playwright image pin
gitleaks-image|invalid Gitleaks image pin
node-version|invalid Node version pin
pnpm-version|invalid pnpm version pin
pnpm-integrity|invalid pnpm integrity pin
pnpm-padding|invalid pnpm integrity pin
TOOLCHAIN_FAILURES

mkdir -p "$test_root/pristine-source/packages/example"
printf 'authored\n' >"$test_root/pristine-source/authored.txt"
snapshot_source "$test_root/pristine-source" pristine \
  >"$test_root/pristine-source.json"
for generated_path in \
  node_modules \
  packages/example/dist \
  packages/example/coverage \
  packages/example/.turbo \
  packages/example/.next \
  packages/example/storybook-static; do
  mkdir -p "$test_root/pristine-source/$generated_path"
  expect_failure \
    "pristine-${generated_path//\//-}" \
    'generated path exists in source export' \
    snapshot_source "$test_root/pristine-source" pristine
  rmdir "$test_root/pristine-source/$generated_path"
done
printf 'compiler state\n' >"$test_root/pristine-source/example.tsbuildinfo"
expect_failure pristine-tsbuildinfo 'generated path exists in source export' \
  snapshot_source "$test_root/pristine-source" pristine

mkdir -p "$test_root/source/packages/example/node_modules/example"
printf 'authored\n' >"$test_root/source/authored.txt"
printf 'dependency\n' \
  >"$test_root/source/packages/example/node_modules/example/index.js"
snapshot_source "$test_root/source" >"$test_root/source.before.json"
printf 'changed dependency\n' \
  >"$test_root/source/packages/example/node_modules/example/index.js"
snapshot_source "$test_root/source" >"$test_root/source.dependencies.json"
cmp "$test_root/source.before.json" "$test_root/source.dependencies.json"
printf 'mutated\n' >"$test_root/source/authored.txt"
snapshot_source "$test_root/source" >"$test_root/source.after.json"
if cmp -s "$test_root/source.before.json" "$test_root/source.after.json"; then
  echo 'SDK source snapshot missed an authored-file mutation' >&2
  exit 1
fi

snapshot_source "$test_root/source" post-lifecycle \
  >"$test_root/source.strict-before.json"
mkdir -p "$test_root/source/packages/example/dist"
printf 'lifecycle output\n' \
  >"$test_root/source/packages/example/dist/injected.js"
snapshot_source "$test_root/source" post-lifecycle \
  >"$test_root/source.strict-after.json"
if cmp -s \
  "$test_root/source.strict-before.json" \
  "$test_root/source.strict-after.json"; then
  echo 'SDK post-lifecycle snapshot ignored a generated-root mutation' >&2
  exit 1
fi

snapshot_source "$test_root/source" >"$test_root/source.authored-before.json"
printf 'generated compiler state\n' >"$test_root/source/generated.tsbuildinfo"
snapshot_source "$test_root/source" >"$test_root/source.authored-after.json"
cmp \
  "$test_root/source.authored-before.json" \
  "$test_root/source.authored-after.json"

mkdir -p "$test_root/hardlink-source/node_modules"
printf 'authored\n' >"$test_root/hardlink-source/authored.txt"
ln "$test_root/hardlink-source/authored.txt" \
  "$test_root/hardlink-source/node_modules/alias.txt"
if snapshot_source "$test_root/hardlink-source" \
  >"$test_root/hardlink.output" 2>&1; then
  echo 'SDK source snapshot accepted an excluded hard-link alias' >&2
  exit 1
fi

mkdir -p \
  "$test_root/export-fixture/repository" \
  "$test_root/export-fixture/export"
git -C "$test_root/export-fixture/repository" init -q
git -C "$test_root/export-fixture/repository" config \
  user.email ci-fixture@invalid.local
git -C "$test_root/export-fixture/repository" config \
  user.name 'CI fixture'
printf 'baseline\n' \
  >"$test_root/export-fixture/repository/baseline.txt"
printf '#!/bin/sh\nexit 0\n' \
  >"$test_root/export-fixture/repository/executable.sh"
chmod 755 "$test_root/export-fixture/repository/executable.sh"
ln -s baseline.txt "$test_root/export-fixture/repository/link.txt"
git -C "$test_root/export-fixture/repository" add .
git -C "$test_root/export-fixture/repository" commit \
  --quiet -m 'test fixture: source export'
GIT_NO_REPLACE_OBJECTS=1 \
  git -C "$test_root/export-fixture/repository" \
    ls-tree -rz --full-tree HEAD \
    >"$test_root/export-fixture/tree"
export_object_format=$(
  GIT_NO_REPLACE_OBJECTS=1 \
    git -C "$test_root/export-fixture/repository" \
      rev-parse --show-object-format
)
reset_export_fixture
verify_export_fixture >/dev/null

printf 'mutated\n' >"$test_root/export-fixture/export/baseline.txt"
expect_export_rejected content 'source export content mismatch'
reset_export_fixture

chmod 755 "$test_root/export-fixture/export/baseline.txt"
expect_export_rejected mode 'source export mode mismatch'
reset_export_fixture

rm "$test_root/export-fixture/export/baseline.txt"
expect_export_rejected omitted 'source export omitted tracked path'
reset_export_fixture

printf 'extra\n' >"$test_root/export-fixture/export/extra.txt"
expect_export_rejected extra 'source export added untracked path'
reset_export_fixture

rm "$test_root/export-fixture/export/link.txt"
ln -s executable.sh "$test_root/export-fixture/export/link.txt"
expect_export_rejected symlink 'source export content mismatch'
reset_export_fixture

ln "$test_root/export-fixture/export/baseline.txt" \
  "$test_root/export-fixture/hardlink-alias"
expect_export_rejected hardlink 'source export contains a hard-linked file'
rm "$test_root/export-fixture/hardlink-alias"

other_volume=$(
  docker volume create \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_other}"
)
if sdk_ci_remove_volume "$other_volume" "$resource_owner" \
  >"$test_root/volume-ownership.output" 2>&1; then
  echo 'SDK resource ownership accepted an unowned volume' >&2
  exit 1
fi
docker volume inspect "$other_volume" >/dev/null

owned_volume=$(
  docker volume create \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_owner}"
)
recovered_volume=$(sdk_ci_single_volume "$resource_owner")
if [[ "$recovered_volume" != "$owned_volume" ]]; then
  echo 'SDK resource ownership did not recover the owned volume' >&2
  exit 1
fi
sdk_ci_remove_volume "$recovered_volume" "$resource_owner"
owned_volume=''

ambiguous_volume_one=$(
  docker volume create \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_owner}"
)
ambiguous_volume_two=$(
  docker volume create \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_owner}"
)
if sdk_ci_single_volume "$resource_owner" \
  >"$test_root/ambiguous-volume.output" 2>&1; then
  echo 'SDK resource ownership accepted ambiguous volume discovery' >&2
  exit 1
fi

if (
  # shellcheck disable=SC2329
  sdk_ci_find_volumes() { return 42; }
  sdk_ci_single_volume "$resource_owner"
) >"$test_root/finder-failure.output" 2>&1; then
  echo 'SDK resource ownership hid a volume finder failure' >&2
  exit 1
fi

if (
  # shellcheck disable=SC2329
  docker() {
    if [[ "$1 $2" == 'volume inspect' ]]; then
      printf '%s\n' "$resource_owner"
      return 0
    fi
    return 42
  }
  sdk_ci_remove_volume 'fixture-volume' "$resource_owner"
) >"$test_root/removal-failure.output" 2>&1; then
  echo 'SDK resource ownership hid a volume removal failure' >&2
  exit 1
fi

image_container=$(
  docker create \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_owner}" \
    "$AUTHOWL_CI_IMAGE" true
)
owned_image=$(
  docker commit \
    --change "LABEL ${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_owner}" \
    "$image_container"
)
docker rm "$image_container" >/dev/null
image_container=''
recovered_image=$(sdk_ci_single_image "$resource_owner")
if [[ "$recovered_image" != "$owned_image" ]]; then
  echo 'SDK resource ownership did not recover the owned image' >&2
  exit 1
fi
if sdk_ci_remove_image "$owned_image" "$resource_other" \
  >"$test_root/image-ownership.output" 2>&1; then
  echo 'SDK resource ownership accepted an unowned image' >&2
  exit 1
fi
docker image inspect "$owned_image" >/dev/null

image_container=$(
  docker create \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_owner}" \
    "$AUTHOWL_CI_IMAGE" true
)
ambiguous_image=$(
  docker commit \
    --change "LABEL ${AUTHOWL_SDK_CI_RUN_LABEL}=${resource_owner}" \
    "$image_container"
)
docker rm "$image_container" >/dev/null
image_container=''
if sdk_ci_single_image "$resource_owner" \
  >"$test_root/ambiguous-image.output" 2>&1; then
  echo 'SDK resource ownership accepted ambiguous image discovery' >&2
  exit 1
fi
sdk_ci_remove_image "$ambiguous_image" "$resource_owner"
ambiguous_image=''

sdk_ci_remove_image "$recovered_image" "$resource_owner"
owned_image=''

echo 'SDK local-gate preflight tests: OK'
