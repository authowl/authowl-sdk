#!/usr/bin/env bash
# Shared pinned-image build and SDK runner. Callers supply isolated workspace paths.

# Docker refuses `--cpus` above the host's core count ("range of CPUs is from
# 0.01 to 2.00, as there are only 2 CPUs available"), which killed the whole
# release gate on a 2-core GitHub runner before it built anything. Ask for the
# budget we want, take what the host actually has.
gate_cpus() {
  local want="$1" have
  have=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)
  if [ "$want" -le "$have" ]; then echo "$want"; else echo "$have"; fi
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

sdk_ci_run() {
  local network=$1
  shift
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
    --network "$network" \
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
