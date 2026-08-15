#!/usr/bin/env bash

readonly AUTHOWL_SDK_CI_RUN_LABEL='dev.authowl.sdk-ci.run'

sdk_ci_find_images() {
  local expected_run_id=$1
  docker images --all --quiet \
    --filter "label=${AUTHOWL_SDK_CI_RUN_LABEL}=${expected_run_id}"
}

sdk_ci_find_volumes() {
  local expected_run_id=$1
  docker volume list --quiet \
    --filter "label=${AUTHOWL_SDK_CI_RUN_LABEL}=${expected_run_id}"
}

sdk_ci_single() {
  local finder=$1
  local expected_run_id=$2
  local output
  local candidate
  local found=''
  local count=0
  output=$("$finder" "$expected_run_id") || return 1
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    found=$candidate
    count=$((count + 1))
  done < <(printf '%s\n' "$output")
  [[ "$count" -le 1 ]] || return 1
  printf '%s' "$found"
}

sdk_ci_single_image() {
  local image_id
  image_id=$(sdk_ci_single sdk_ci_find_images "$1") || return 1
  if [[ -z "$image_id" ]]; then
    return 0
  fi
  docker image inspect --format '{{.Id}}' "$image_id"
}

sdk_ci_single_volume() {
  sdk_ci_single sdk_ci_find_volumes "$1"
}

sdk_ci_remove_image() {
  local image_id=$1
  local expected_run_id=$2
  local actual
  actual=$(docker image inspect --format \
    "{{ index .Config.Labels \"${AUTHOWL_SDK_CI_RUN_LABEL}\" }}" "$image_id") ||
    return 1
  if [[ "$actual" != "$expected_run_id" ]]; then
    echo 'SDK CI: refusing to remove an unowned image' >&2
    return 1
  fi
  docker image rm "$image_id" >/dev/null
}

sdk_ci_remove_volume() {
  local volume_name=$1
  local expected_run_id=$2
  local actual
  actual=$(docker volume inspect --format \
    "{{ index .Labels \"${AUTHOWL_SDK_CI_RUN_LABEL}\" }}" "$volume_name") ||
    return 1
  if [[ "$actual" != "$expected_run_id" ]]; then
    echo 'SDK CI: refusing to remove an unowned volume' >&2
    return 1
  fi
  docker volume rm "$volume_name" >/dev/null
}
