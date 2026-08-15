#!/usr/bin/env bash
#
# Canonical AuthOwl SDK merge and release gate. It builds a pinned Linux
# Node/Playwright image without exposing source, checks an immutable captured
# commit, and records only privacy-safe named results.
#
set -euo pipefail

# Docker refuses `--cpus` above the host's core count ("range of CPUs is from
# 0.01 to 2.00, as there are only 2 CPUs available"), which killed the whole
# release gate on a 2-core GitHub runner before it built anything. Ask for the
# budget we want, take what the host actually has.
gate_cpus() {
  local want="$1" have
  have=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)
  if [ "$want" -le "$have" ]; then echo "$want"; else echo "$have"; fi
}
umask 077

root=$(cd "$(dirname "$0")/../.." && pwd -P)
cd "$root"

if [[ $# -ne 0 ]]; then
  echo 'SDK local-gate: arguments are not supported' >&2
  exit 2
fi
export_release_artifacts=${AUTHOWL_EXPORT_RELEASE_ARTIFACTS:-0}
if [[ "$export_release_artifacts" != '0' && "$export_release_artifacts" != '1' ]]; then
  echo 'SDK local-gate: AUTHOWL_EXPORT_RELEASE_ARTIFACTS must be 0 or 1' >&2
  exit 2
fi
for required_command in docker find git tar; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "SDK local-gate: required command is unavailable: $required_command" >&2
    exit 2
  fi
done
if [[ "$(GIT_NO_REPLACE_OBJECTS=1 git rev-parse --is-shallow-repository)" == 'true' ]]; then
  echo 'SDK local-gate: full Git history is required for the Gitleaks gate' >&2
  exit 2
fi

commit=$(GIT_NO_REPLACE_OBJECTS=1 git rev-parse --verify HEAD)
readonly commit
tree=$(GIT_NO_REPLACE_OBJECTS=1 git rev-parse --verify "$commit^{tree}")
readonly tree
readonly release_base="$root/.authowl-release"
readonly release_target="$release_base/$commit"
release_stage=''
release_finalized=0

if [[ "$export_release_artifacts" == '1' ]]; then
  if [[ -L "$release_base" ]]; then
    echo 'SDK local-gate: release directory must not be a symbolic link' >&2
    exit 2
  fi
  mkdir -p "$release_base"
  if [[ ! -d "$release_base" || -e "$release_target" ]]; then
    echo 'SDK local-gate: release target must be an absent directory under .authowl-release' >&2
    exit 2
  fi
fi
if GIT_NO_REPLACE_OBJECTS=1 git ls-tree -r "$commit" |
  awk '$2 == "commit" { found=1 } END { exit !found }'; then
  echo 'SDK local-gate: Git submodules are not supported' >&2
  exit 2
fi
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo 'SDK local-gate: the exact-commit gate requires a clean worktree' >&2
  exit 2
fi

ownership_helper=$(
  GIT_NO_REPLACE_OBJECTS=1 git show \
    "$commit:scripts/ci/docker-resource-ownership.sh"
)
toolchain_helper=$(
  GIT_NO_REPLACE_OBJECTS=1 git show \
    "$commit:scripts/ci/toolchain-contract.sh"
)
toolchain_contract=$(
  GIT_NO_REPLACE_OBJECTS=1 git show "$commit:docker/ci-toolchain.env"
)
# shellcheck source=/dev/stdin
# shellcheck disable=SC1091
source /dev/stdin <<<"$ownership_helper"
# shellcheck source=/dev/stdin
# shellcheck disable=SC1091
source /dev/stdin <<<"$toolchain_helper"
sdk_ci_load_toolchain /dev/stdin <<<"$toolchain_contract"

if [[ "$(GIT_NO_REPLACE_OBJECTS=1 git show "$commit:.nvmrc")" != "${NODE_VERSION#v}" ]]; then
  echo 'SDK local-gate: .nvmrc must match the pinned Linux runtime' >&2
  exit 2
fi

started_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
readonly started_at
run_root=$(mktemp -d "${TMPDIR:-/tmp}/authowl-sdk-ci.XXXXXXXX")
readonly run_root
readonly run_nonce="${run_root##*.}"
readonly run_id="${commit:0:12}-${run_nonce}"
readonly ci_image_tag="authowl-sdk-ci:${run_id}"
readonly repository_mirror="$run_root/repository.git"
readonly immutable_repository="$run_root/repository"
readonly workspace="$run_root/source"
readonly image_context="$run_root/image-context"
readonly step_file="$run_root/current-step"
readonly completed_file="$run_root/completed-steps"
readonly result_header="$run_root/result-header"
readonly tree_manifest="$run_root/git-tree"
readonly source_before="$run_root/source-before.json"
readonly source_after_install="$run_root/source-after-install.json"
readonly source_after_checks="$run_root/source-after-checks.json"
readonly pristine_source="$run_root/pristine-source.json"
readonly dependency_input="$run_root/dependency-input"
readonly npm_next_consumer_input="$run_root/npm-next-consumer-input"
readonly npm_vite_consumer_input="$run_root/npm-vite-consumer-input"
readonly npm_cache="$run_root/npm-cache"
readonly consumer_workspace="$run_root/consumer"

result_base=${AUTHOWL_CI_RESULT_DIR:-"$root/.authowl-ci/results"}
if [[ -L "$result_base" ]]; then
  echo 'SDK local-gate: result directory must not be a symbolic link' >&2
  exit 2
fi
mkdir -p "$result_base"
if [[ ! -d "$result_base" ]]; then
  echo 'SDK local-gate: result path is not a directory' >&2
  exit 2
fi
result_dir=$(mktemp -d "$result_base/run.XXXXXXXX")
readonly result_dir
readonly result_file="$result_dir/$commit-$started_at-$run_nonce.txt"

mkdir -p \
  "$workspace" \
  "$image_context" \
  "$dependency_input/node_modules" \
  "$npm_next_consumer_input" \
  "$npm_vite_consumer_input" \
  "$npm_cache" \
  "$consumer_workspace/tgz" \
  "$consumer_workspace/scripts/ci"
touch "$step_file" "$completed_file"
ci_image_id=''
dependency_store_volume=''
dependency_modules_volume=''
gate_status='failed'

cleanup() {
  local body_status=$?
  local failed_step
  local completed_steps
  local header
  local result_temp
  local discovered
  local cleanup_failed=0
  local evidence_failed=0
  local cleanup_result='passed'
  trap - EXIT INT TERM
  set +e
  failed_step=$(<"$step_file") || failed_step='bootstrap'
  completed_steps=$(<"$completed_file") || completed_steps=''
  header=$(<"$result_header") || header=''
  if [[ -z "$header" ]]; then evidence_failed=1; fi

  if [[ -z "$ci_image_id" ]]; then
    if discovered=$(sdk_ci_single_image "$run_id"); then
      ci_image_id=$discovered
    else
      cleanup_failed=1
    fi
  fi
  if [[ -n "$ci_image_id" ]] &&
    ! sdk_ci_remove_image \
      "$ci_image_id" "$run_id" >/dev/null 2>&1; then
    cleanup_failed=1
  fi
  if discovered=$(sdk_ci_find_volumes "$run_id"); then
    while IFS= read -r volume_name; do
      [[ -z "$volume_name" ]] && continue
      if ! sdk_ci_remove_volume \
        "$volume_name" "$run_id" >/dev/null 2>&1; then
        cleanup_failed=1
      fi
    done <<<"$discovered"
  else
    cleanup_failed=1
  fi
  if ! rm -rf "$run_root"; then cleanup_failed=1; fi

  if [[ "$export_release_artifacts" == '1' ]]; then
    if [[ "$body_status" -eq 0 && "$gate_status" == 'passed' && "$cleanup_failed" -eq 0 ]]; then
      if [[ -z "$release_stage" || ! -d "$release_stage" || -e "$release_target" ]] ||
        ! mv "$release_stage" "$release_target"; then
        cleanup_failed=1
      else
        release_finalized=1
      fi
    fi
    if [[ "$release_finalized" -eq 0 && -n "$release_stage" && -e "$release_stage" ]]; then
      if ! rm -rf "$release_stage"; then cleanup_failed=1; fi
    fi
  fi

  if [[ "$cleanup_failed" -ne 0 ]]; then
    cleanup_result='failed'
    if [[ "$body_status" -eq 0 ]]; then
      gate_status='failed'
      failed_step='cleanup'
      body_status=1
    fi
  fi

  result_temp="$result_dir/.result.tmp"
  if [[ "$evidence_failed" -ne 0 ]]; then
    :
  elif ! (
    set -o noclobber
    {
      printf '%s\n' "$header"
      if [[ -n "$completed_steps" ]]; then
        printf '%s\n' "$completed_steps"
      fi
      printf 'result.cleanup=%s\n' "$cleanup_result"
      printf 'status=%s\n' "$gate_status"
      if [[ "$gate_status" != 'passed' ]]; then
        printf 'failed_step=%s\n' "$failed_step"
      fi
      printf 'finished_at=%s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    } >"$result_temp"
  ); then
    evidence_failed=1
  elif ! mv "$result_temp" "$result_file"; then
    evidence_failed=1
  fi

  if [[ "$body_status" -eq 0 && "$evidence_failed" -ne 0 ]]; then
    gate_status='failed'
    failed_step='evidence-finalization'
    body_status=1
  fi

  if [[ "$body_status" -ne 0 && "$release_finalized" -eq 1 ]]; then
    if ! rm -rf "$release_target"; then
      cleanup_failed=1
    fi
    release_finalized=0
  fi

  if [[ "$body_status" -eq 0 && "$gate_status" == 'passed' && "$evidence_failed" -eq 0 ]]; then
    printf 'SDK local-gate: PASSED\nSDK local-gate: privacy-safe result: %s\n' \
      "$result_file"
    if [[ "$release_finalized" -eq 1 ]]; then
      printf 'SDK local-gate: release artifacts: %s\n' "$release_target"
    fi
  else
    printf 'SDK local-gate: FAILED at %s\n' "$failed_step" >&2
    if [[ "$cleanup_failed" -ne 0 ]]; then
      printf 'SDK local-gate: CLEANUP FAILED for run %s\n' "$run_id" >&2
    fi
    if [[ "$evidence_failed" -eq 0 ]]; then
      printf 'SDK local-gate: privacy-safe result: %s\n' "$result_file" >&2
    else
      echo 'SDK local-gate: privacy-safe result finalization failed' >&2
    fi
  fi
  exit "$body_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_step() {
  local name=$1
  shift
  printf '%s' "$name" >"$step_file"
  printf '\nSDK local-gate: [%s]\n' "$name"
  "$@"
  printf 'result.%s=passed\n' "$name" >>"$completed_file"
}

prepare_immutable_repository() {
  (
    umask 022
    GIT_NO_REPLACE_OBJECTS=1 \
      git clone --quiet --no-checkout \
        "$repository_mirror" "$immutable_repository"
    GIT_NO_REPLACE_OBJECTS=1 \
      git -C "$immutable_repository" checkout --quiet --detach "$commit"
  )
  [[ -z "$(git -C "$immutable_repository" status --porcelain=v1 --untracked-files=all)" ]]
}

validate_archive_attributes() {
  local attribute_path
  local attribute_name
  local attribute_value
  while IFS= read -r -d '' attribute_path &&
    IFS= read -r -d '' attribute_name &&
    IFS= read -r -d '' attribute_value; do
    case "$attribute_value" in
      unspecified | unset) ;;
      *)
        printf 'SDK local-gate: archive-transforming attribute is forbidden: %s %s=%s\n' \
          "$attribute_path" "$attribute_name" "$attribute_value" >&2
        return 1
        ;;
    esac
  done < <(
    {
      git -C "$immutable_repository" ls-files -z
      GIT_NO_REPLACE_OBJECTS=1 \
        git --git-dir="$repository_mirror" \
        ls-tree -rd --name-only -z "$commit"
    } |
      git -C "$immutable_repository" \
        check-attr --cached --stdin -z export-ignore export-subst
  )
}

build_ci_image() {
  cp "$immutable_repository/docker/ci.Dockerfile" "$image_context/Dockerfile"
  docker build \
    --pull \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${run_id}" \
    --build-arg "NODE_BASE_IMAGE=${NODE_BASE_IMAGE}" \
    --build-arg "PLAYWRIGHT_BASE_IMAGE=${PLAYWRIGHT_BASE_IMAGE}" \
    --build-arg "NODE_VERSION=${NODE_VERSION}" \
    --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
    --build-arg "PNPM_INTEGRITY=${PNPM_INTEGRITY}" \
    --tag "$ci_image_tag" \
    "$image_context"
  ci_image_id=$(docker image inspect --format '{{.Id}}' "$ci_image_tag")
  printf 'tool.ci_image=%s\n' "$ci_image_id" >>"$completed_file"
}

prepare_dependency_store() {
  dependency_store_volume=$(
    docker volume create \
      --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${run_id}"
  )
  dependency_modules_volume=$(
    docker volume create \
      --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${run_id}"
  )
  docker run --rm \
    --init \
    --network none \
    --read-only \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add CHOWN \
    --security-opt no-new-privileges:true \
    --memory 128m \
    --cpus "$(gate_cpus 1)" \
    --pids-limit 32 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
    --mount "type=volume,src=$dependency_store_volume,dst=/pnpm-store" \
    --mount "type=volume,src=$dependency_modules_volume,dst=/fetch-modules" \
    --env "CACHE_UID=$(id -u)" \
    --env "CACHE_GID=$(id -g)" \
    "$ci_image_tag" sh -euc '
      chown "$CACHE_UID:$CACHE_GID" /pnpm-store /fetch-modules
    '
}

run_preflight_tests() {
  env \
    AUTHOWL_CI_IMAGE="$ci_image_tag" \
    AUTHOWL_CI_ROOT="$immutable_repository" \
    bash "$immutable_repository/scripts/ci/test-local-gate-preflight.sh"
}

run_semgrep() {
  (
    cd "$immutable_repository"
    bash scripts/ci/semgrep-check.sh
  )
}

archive_source() {
  GIT_NO_REPLACE_OBJECTS=1 \
    git --git-dir="$repository_mirror" archive --format=tar "$commit" |
    tar -xf - -C "$workspace"
}

write_tree_manifest() {
  GIT_NO_REPLACE_OBJECTS=1 \
    git --git-dir="$repository_mirror" ls-tree -rz --full-tree "$commit" \
    >"$tree_manifest"
}

verify_source_export() {
  local object_format
  object_format=$(
    GIT_NO_REPLACE_OBJECTS=1 \
      git --git-dir="$repository_mirror" rev-parse --show-object-format
  )
  docker run --rm \
    --init \
    --network none \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 1g \
    --cpus "$(gate_cpus 1)" \
    --pids-limit 128 \
    --mount "type=bind,src=$workspace,dst=/workspace,readonly" \
    --mount "type=bind,src=$tree_manifest,dst=/ci/git-tree,readonly" \
    --mount "type=bind,src=$immutable_repository/scripts/ci/verify-source-export.mjs,dst=/ci/verify-source-export.mjs,readonly" \
    "$ci_image_tag" node /ci/verify-source-export.mjs \
    /workspace /ci/git-tree "$object_format"
}

snapshot_source() {
  local output_file=$1
  local snapshot_mode=${2:-authored}
  docker run --rm \
    --init \
    --network none \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 1g \
    --cpus "$(gate_cpus 1)" \
    --pids-limit 128 \
    --mount "type=bind,src=$workspace,dst=/workspace,readonly" \
    --mount "type=bind,src=$immutable_repository/scripts/ci/snapshot-source.mjs,dst=/ci/snapshot-source.mjs,readonly" \
    "$ci_image_tag" node /ci/snapshot-source.mjs \
    /workspace "$snapshot_mode" >"$output_file"
}

prepare_dependency_input() {
  local manifest_list="$run_root/dependency-manifests"
  GIT_NO_REPLACE_OBJECTS=1 git -C "$immutable_repository" ls-files -z \
    package.json \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    ':(glob)**/package.json' \
    >"$manifest_list"
  COPYFILE_DISABLE=1 tar --null -C "$workspace" -T "$manifest_list" -cf - |
    tar -xf - -C "$dependency_input"
  cp \
    "$workspace/scripts/ci/fixtures/next-consumer/package.json" \
    "$npm_next_consumer_input/package.json"
  node "$workspace/scripts/ci/prepare-npm-consumer-input.mjs" \
    "$npm_next_consumer_input/package.json" \
    "$workspace/packages/auth-core/package.json" \
    "$workspace/packages/auth-react/package.json" \
    "$workspace/packages/auth-next/package.json"
  cp \
    "$workspace/scripts/ci/fixtures/vite-consumer/package.json" \
    "$npm_vite_consumer_input/package.json"
  node "$workspace/scripts/ci/prepare-npm-consumer-input.mjs" \
    "$npm_vite_consumer_input/package.json" \
    "$workspace/packages/auth-core/package.json" \
    "$workspace/packages/auth-react/package.json"
}

docker_dependency_network() {
  local ecosystem=$1
  local input_mount
  local -a storage_mounts
  local -a ecosystem_environment
  shift
  case "$ecosystem" in
    pnpm)
      input_mount="type=bind,src=$dependency_input,dst=/input,readonly"
      storage_mounts=(
        --mount "type=volume,src=$dependency_store_volume,dst=/pnpm-store"
        --mount "type=volume,src=$dependency_modules_volume,dst=/input/node_modules"
      )
      ecosystem_environment=(
        --env COREPACK_ENABLE_DOWNLOAD_PROMPT=0
        # Keep pnpm's heap below the Docker VM's global memory ceiling. File
        # cache and the pinned Expo graph still need room outside the JS heap.
        --env NODE_OPTIONS=--max-old-space-size=2048
      )
      ;;
    npm-next | npm-vite)
      if [[ "$ecosystem" == 'npm-next' ]]; then
        input_mount="type=bind,src=$npm_next_consumer_input,dst=/input"
      else
        input_mount="type=bind,src=$npm_vite_consumer_input,dst=/input"
      fi
      storage_mounts=(
        --mount "type=bind,src=$npm_cache,dst=/npm-cache"
      )
      ecosystem_environment=(
        --env npm_config_cache=/npm-cache
        --env npm_config_update_notifier=false
      )
      ;;
    *)
      echo "SDK local-gate: unsupported dependency ecosystem: $ecosystem" >&2
      return 2
      ;;
  esac
  docker run --rm \
    --init \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 8g \
    --cpus "$(gate_cpus 2)" \
    --pids-limit 256 \
    --tmpfs /tmp:rw,nosuid,nodev,size=512m \
    --mount "$input_mount" \
    "${storage_mounts[@]}" \
    --workdir /input \
    --env HOME=/tmp \
    --env CI=true \
    "${ecosystem_environment[@]}" \
    "$ci_image_tag" "$@"
}

docker_sdk_offline() {
  local -a additional_mounts=()
  local -a additional_environment=()
  if [[ "${1:-}" == '--consumer-exec-tmp' ]]; then
    additional_mounts=(
      --tmpfs '/consumer-tmp:rw,exec,nosuid,nodev,size=2g'
    )
    additional_environment=(
      --env AUTHOWL_CONSUMER_TMPDIR=/consumer-tmp
    )
    shift
  fi
  docker run --rm \
    --init \
    --network none \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 8g \
    --cpus "$(gate_cpus 4)" \
    --pids-limit 2048 \
    --shm-size 2g \
    --tmpfs /tmp:rw,nosuid,nodev,size=2g \
    "${additional_mounts[@]+"${additional_mounts[@]}"}" \
    --mount "type=bind,src=$workspace,dst=/workspace" \
    --mount "type=volume,src=$dependency_store_volume,dst=/pnpm-store" \
    --mount "type=bind,src=$npm_cache,dst=/npm-cache" \
    --workdir /workspace \
    --env HOME=/tmp \
    --env CI=true \
    --env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    --env npm_config_cache=/npm-cache \
    --env npm_config_offline=true \
    --env npm_config_audit=false \
    --env npm_config_fund=false \
    --env npm_config_logs_dir=/tmp/npm-logs \
    --env npm_config_update_notifier=false \
    "${additional_environment[@]+"${additional_environment[@]}"}" \
    "$ci_image_tag" "$@"
}

prepare_consumer_workspace() {
  cp \
    "$immutable_repository/scripts/ci/cli-install-check.sh" \
    "$immutable_repository/scripts/ci/admin-server-install-check.sh" \
    "$immutable_repository/scripts/ci/convex-install-check.sh" \
    "$immutable_repository/scripts/ci/packed-runtime-install-check.sh" \
    "$consumer_workspace/scripts/ci/"
  docker run --rm \
    --init \
    --network none \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 2g \
    --cpus "$(gate_cpus 2)" \
    --pids-limit 256 \
    --tmpfs /tmp:rw,nosuid,nodev,size=512m \
    --mount "type=bind,src=$workspace,dst=/workspace,readonly" \
    --mount "type=bind,src=$consumer_workspace,dst=/consumer" \
    --workdir /workspace \
    --env HOME=/tmp \
    --env CI=true \
    --env npm_config_ignore_scripts=true \
    "$ci_image_tag" sh -euc '
      (cd packages/cli &&
        pnpm pack --pack-destination /consumer/tgz >/dev/null)
      (cd packages/auth-core &&
        pnpm pack --pack-destination /consumer/tgz >/dev/null)
      (cd packages/auth-react &&
        pnpm pack --pack-destination /consumer/tgz >/dev/null)
      (cd packages/auth-next &&
        pnpm pack --pack-destination /consumer/tgz >/dev/null)
      (cd packages/auth-convex &&
        pnpm pack --pack-destination /consumer/tgz >/dev/null)
      (cd packages/auth-react-native &&
        pnpm pack --pack-destination /consumer/tgz >/dev/null)
      (cd packages/auth-expo &&
        pnpm pack --pack-destination /consumer/tgz >/dev/null)
    '
}

prepare_release_artifacts() {
  release_stage=$(mktemp -d "$release_base/.stage-$commit.XXXXXXXX")
  docker run --rm \
    --init \
    --network none \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 1g \
    --cpus "$(gate_cpus 1)" \
    --pids-limit 128 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
    --mount "type=bind,src=$consumer_workspace/tgz,dst=/artifacts,readonly" \
    --mount "type=bind,src=$release_stage,dst=/release" \
    --mount "type=bind,src=$immutable_repository,dst=/repo,readonly" \
    --workdir /repo \
    --env HOME=/tmp \
    "$ci_image_tag" node scripts/release/artifact-contract.mjs create \
      /artifacts /release /repo "$commit" "$tree"
}

docker_consumer_network() {
  docker run --rm \
    --init \
    --read-only \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 4g \
    --cpus "$(gate_cpus 2)" \
    --pids-limit 512 \
    --shm-size 1g \
    --tmpfs /tmp:rw,nosuid,nodev,size=2g \
    --tmpfs /consumer-tmp:rw,exec,nosuid,nodev,size=2g \
    --mount "type=bind,src=$consumer_workspace,dst=/proof,readonly" \
    --workdir /proof \
    --env HOME=/tmp \
    --env TMPDIR=/consumer-tmp \
    --env CI=true \
    --env AUTHOWL_PREPACKED_DIR=/proof/tgz \
    "$ci_image_tag" sh -euc '
      printf "#!/bin/sh\nexit 0\n" >/tmp/authowl-exec-probe
      chmod 700 /tmp/authowl-exec-probe
      if /tmp/authowl-exec-probe 2>/dev/null; then
        echo "general consumer temporary filesystem must be non-executable" >&2
        exit 1
      fi
      printf "#!/bin/sh\nexit 0\n" >"$TMPDIR/authowl-exec-probe"
      chmod 700 "$TMPDIR/authowl-exec-probe"
      "$TMPDIR/authowl-exec-probe"
      exec "$@"
    ' authowl-consumer "$@"
}

verify_release_hooks() {
  docker_sdk_offline sh -euc \
    'pnpm list --recursive --depth -1 --json | node scripts/ci/release-hook-check.mjs'
}

{
  printf 'schema=1\n'
  printf 'repository=authowl-sdk\n'
  printf 'commit=%s\n' "$commit"
  printf 'tree=%s\n' "$tree"
  printf 'started_at=%s\n' "$started_at"
  printf 'enforcement=solo-local\n'
  printf 'node_base_image=%s\n' "$NODE_BASE_IMAGE"
  printf 'playwright_base_image=%s\n' "$PLAYWRIGHT_BASE_IMAGE"
  printf 'node_runtime=%s/linux\n' "$NODE_VERSION"
  printf 'pnpm_runtime=%s\n' "$PNPM_VERSION"
  printf 'pnpm_integrity=%s\n' "$PNPM_INTEGRITY"
  printf 'gitleaks_image=%s\n' "$GITLEAKS_IMAGE"
  printf 'host=%s/%s\n' "$(uname -s)" "$(uname -m)"
  printf 'docker_server=%s\n' "$(docker version --format '{{.Server.Version}}')"
} >"$result_header"

run_step history-mirror env GIT_NO_REPLACE_OBJECTS=1 \
  git clone --mirror --no-hardlinks "$root" "$repository_mirror"
run_step immutable-checkout prepare_immutable_repository
run_step archive-attributes validate_archive_attributes
run_step ci-image build_ci_image
run_step dependency-store prepare_dependency_store
run_step gate-preflight-tests run_preflight_tests
run_step semgrep run_semgrep
run_step gitleaks docker run --rm \
  --network none \
  --read-only \
  --user "$(id -u):$(id -g)" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 1g \
  --cpus "$(gate_cpus 2)" \
  --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --env HOME=/tmp \
  --env GIT_NO_REPLACE_OBJECTS=1 \
  --mount "type=bind,src=$repository_mirror,dst=/repo,readonly" \
  --mount "type=bind,src=$immutable_repository/.gitleaks.toml,dst=/ci/gitleaks.toml,readonly" \
  "$GITLEAKS_IMAGE" git /repo \
    --config=/ci/gitleaks.toml \
    --log-opts=--all \
    --redact=100

run_step source-archive archive_source
run_step git-tree-manifest write_tree_manifest
run_step source-export-integrity verify_source_export
run_step generated-roots-absent snapshot_source "$pristine_source" pristine
run_step source-snapshot-before snapshot_source \
  "$source_before" post-lifecycle
run_step dependency-input prepare_dependency_input
run_step npm-next-consumer-fetch docker_dependency_network npm-next \
  npm install --ignore-scripts --no-audit --no-fund
run_step npm-next-consumer-audit docker_dependency_network npm-next \
  npm audit --audit-level high
run_step npm-vite-consumer-fetch docker_dependency_network npm-vite \
  npm install --ignore-scripts --no-audit --no-fund
run_step npm-vite-consumer-audit docker_dependency_network npm-vite \
  npm audit --audit-level high
run_step dependency-fetch docker_dependency_network pnpm \
  pnpm fetch \
    --frozen-lockfile \
    --network-concurrency 2 \
    --store-dir /pnpm-store
run_step production-audit docker_dependency_network pnpm \
  pnpm audit --prod --audit-level high
run_step runtime docker_sdk_offline sh -euc \
  "test \"\$(node --version)\" = '$NODE_VERSION'
  test \"\$(pnpm --version)\" = '$PNPM_VERSION'
  test \"\$(uname -s)\" = Linux
  printf '#!/bin/sh\nexit 0\n' >/tmp/authowl-exec-probe
  chmod 700 /tmp/authowl-exec-probe
  if /tmp/authowl-exec-probe 2>/dev/null; then
    echo 'general container temporary filesystem must be non-executable' >&2
    exit 1
  fi"
run_step install docker_sdk_offline \
  pnpm install \
    --offline \
    --store-dir /pnpm-store \
    --frozen-lockfile \
    --ignore-scripts
run_step dependency-lifecycles docker_sdk_offline pnpm rebuild -r
run_step source-snapshot-after-install snapshot_source \
  "$source_after_install" post-lifecycle
run_step source-integrity-after-install cmp "$source_before" "$source_after_install"

run_step release-hooks verify_release_hooks
run_step build docker_sdk_offline pnpm run build
run_step lint docker_sdk_offline pnpm run lint
run_step typecheck docker_sdk_offline pnpm run typecheck
run_step tests docker_sdk_offline pnpm run test
run_step storybook-build docker_sdk_offline pnpm run build:storybook
run_step storybook-browser docker_sdk_offline pnpm run test:storybook
run_step next-generator docker_sdk_offline --consumer-exec-tmp \
  pnpm run cli:verify-next
run_step vite-generator docker_sdk_offline --consumer-exec-tmp \
  pnpm run cli:verify-vite
run_step bundle-budget docker_sdk_offline node scripts/ci/bundle-budget.mjs
run_step package-boundary docker_sdk_offline \
  bash scripts/ci/package-boundary-check.sh

# Only reviewed tarballs and proof harnesses cross into the network-connected
# consumer phase. The private SDK checkout is never mounted in those containers.
run_step consumer-artifacts prepare_consumer_workspace
run_step packed-cli docker_consumer_network \
  bash scripts/ci/cli-install-check.sh
run_step packed-admin docker_consumer_network \
  bash scripts/ci/admin-server-install-check.sh
run_step packed-convex docker_consumer_network \
  bash scripts/ci/convex-install-check.sh
run_step packed-runtime docker_consumer_network \
  bash scripts/ci/packed-runtime-install-check.sh
run_step source-snapshot-after-checks snapshot_source "$source_after_checks"
run_step source-integrity-after-checks cmp "$source_before" "$source_after_checks"

if [[ "$export_release_artifacts" == '1' ]]; then
  run_step release-artifacts prepare_release_artifacts
fi

gate_status='passed'
