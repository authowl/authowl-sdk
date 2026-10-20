#!/usr/bin/env bash
# Baselines are authored only by Linux Chromium in the canonical pinned image.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd -P)
cd "$root"
if [[ $# -ne 0 ]]; then
  echo 'SDK screenshots: arguments are not supported' >&2
  exit 2
fi
source "$root/scripts/ci/toolchain-contract.sh"
source "$root/scripts/ci/docker-resource-ownership.sh"
source "$root/scripts/ci/docker-sdk.sh"
sdk_ci_load_toolchain "$root/docker/ci-toolchain.env"
umask 077
run_root=$(mktemp -d "${TMPDIR:-/tmp}/authowl-screenshots.XXXXXXXX")
run_id="screenshots-${run_root##*.}"
ci_image_tag="authowl-sdk-ci:$run_id"
ci_image_id=''
immutable_repository="$root"
image_context="$run_root/image-context"
workspace="$run_root/source"
dependency_store_volume=''
npm_cache="$run_root/npm-cache"
completed_file="$run_root/completed-steps"
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$dependency_store_volume" ]]; then
    sdk_ci_remove_volume "$dependency_store_volume" "$run_id" || status=1
  fi
  if [[ -z "$ci_image_id" ]]; then
    ci_image_id=$(sdk_ci_single_image "$run_id") || status=1
  fi
  if [[ -n "$ci_image_id" ]]; then
    sdk_ci_remove_image "$ci_image_id" "$run_id" || status=1
  fi
  rm -rf "$run_root" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$workspace" "$image_context" "$npm_cache"
touch "$completed_file"
# Copy authored working-tree files, including new stories, without host modules
# or ignored build output. All installation/build mutations stay in this copy.
# Tracked files deleted from the working tree (baselines removed to regenerate
# them) are skipped.
git ls-files --cached --others --exclude-standard -z |
  while IFS= read -r -d '' path; do
    [[ -e "$path" ]] && printf '%s\0' "$path"
  done |
  tar --null -T - -cf - | tar -xf - -C "$workspace"
build_ci_image
dependency_store_volume=$(
  docker volume create --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${run_id}"
)
# The shared runner mounts the pnpm volume; grant the invoking user ownership.
docker run --rm --network none --user 0:0 \
  --mount "type=volume,src=$dependency_store_volume,dst=/pnpm-store" \
  "$ci_image_tag" chown "$(id -u):$(id -g)" /pnpm-store
sdk_ci_run default env npm_config_offline=false \
  pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm-store
sdk_ci_run none pnpm rebuild -r
sdk_ci_run none pnpm --filter @authowl/react... build
sdk_ci_run none pnpm --filter @authowl/tokens build
sdk_ci_run none env AUTHOWL_SCREENSHOTS=1 AUTHOWL_SCREENSHOT_UPDATE=1 \
  bash scripts/ci/storybook-browser-check.sh --update
# Copy only successful baseline output back. Review and commit these PNGs with
# the stories before running the exact-commit gate.
mkdir -p "$root/stories/__screenshots__"
cp -R "$workspace/stories/__screenshots__/." "$root/stories/__screenshots__/"
printf 'SDK screenshots: updated stories/__screenshots__; review and commit the PNGs\n'
