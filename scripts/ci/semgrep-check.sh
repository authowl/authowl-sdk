#!/usr/bin/env bash
set -euo pipefail

# Same clamp as scripts/ci/local-gate.sh: docker rejects `--cpus` above the
# host's core count, and a 2-core runner would fail the whole scan.
gate_cpus() {
  local want="$1" have
  have=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)
  if [ "$want" -le "$have" ]; then echo "$want"; else echo "$have"; fi
}

readonly SEMGREP_IMAGE='semgrep/semgrep@sha256:06938c1f365d3f67b8cedd8bc117607ae64253f88a0e768e9da9408548927dd6'
# Semgrep aliases may reorder equivalent YAML. These digests pin the parsed
# policy after mapping keys and top-level rules are placed in canonical order.
# Any semantic policy update remains a reviewed checksum change.
readonly TYPESCRIPT_RULES_CANONICAL_SHA256='df75b4b45dfa077a2acf35a55fd0d5bed7387bfe738d42dcb90f528bb32d84cf'
readonly OWASP_RULES_CANONICAL_SHA256='ff70fa78bea18475e09e9b5148003c84f62ad6bc1e1f0ee050721e8d0a643082'
readonly MAX_TARGET_BYTES=5000000

mode="${1:-scan}"
if [[ "${mode}" != 'scan' && "${mode}" != '--preflight-only' ]]; then
  printf 'Usage: %s [--preflight-only]\n' "$0" >&2
  exit 2
fi

for required_command in git grep wc; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "semgrep-check: ${required_command} is required." >&2
    exit 1
  fi
done

if [[ "${mode}" == 'scan' ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/test-semgrep-preflight.sh"
fi

repo_root="$(git rev-parse --show-toplevel)"

if [[ -n "$(git -C "${repo_root}" status --porcelain --untracked-files=all)" ]]; then
  echo 'semgrep-check: scanning the live working tree, including non-ignored untracked files.' >&2
fi

list_scan_files() {
  local relative_path

  git -C "${repo_root}" ls-files -z --cached --others --exclude-standard |
    while IFS= read -r -d '' relative_path; do
      if [[ -e "${repo_root}/${relative_path}" || -L "${repo_root}/${relative_path}" ]]; then
        printf '%s\0' "${relative_path}"
      fi
    done
}

preflight_failed=0
while IFS= read -r -d '' index_entry; do
  index_metadata="${index_entry%%$'\t'*}"
  relative_path="${index_entry#*$'\t'}"
  index_mode="${index_metadata%% *}"
  if [[ "${index_mode}" == '160000' ]]; then
    printf 'semgrep-check: gitlinks are forbidden in the scan inventory: %q\n' \
      "${relative_path}" >&2
    preflight_failed=1
  fi
done < <(git -C "${repo_root}" ls-files --stage -z)

suppression_marker='nose''m'
approved_suppression_directive="${suppression_marker}grep"
while IFS= read -r -d '' relative_path; do
  case "${relative_path}" in
    .semgrepignore | */.semgrepignore)
      printf 'semgrep-check: repository ignore files are forbidden: %q\n' \
        "${relative_path}" >&2
      preflight_failed=1
      continue
      ;;
  esac

  target_path="${repo_root}/${relative_path}"
  if [[ -L "${target_path}" ]]; then
    printf 'semgrep-check: symbolic links are forbidden in the scan inventory: %q\n' \
      "${relative_path}" >&2
    preflight_failed=1
    continue
  fi

  if [[ ! -f "${target_path}" ]]; then
    printf 'semgrep-check: non-regular scan entries are forbidden: %q\n' \
      "${relative_path}" >&2
    preflight_failed=1
    continue
  fi

  target_bytes="$(wc -c < "${target_path}")"
  if ((target_bytes > MAX_TARGET_BYTES)); then
    printf 'semgrep-check: target exceeds %d bytes: %q (%d bytes)\n' \
      "${MAX_TARGET_BYTES}" "${relative_path}" "${target_bytes}" >&2
    preflight_failed=1
  fi

  case "${relative_path}" in
    packages/cli/test/import-adapters.test.ts)
      expected_suppressions="        // ${approved_suppression_directive}: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash"
      ;;
    scripts/ci/cli-install-check.sh)
      expected_suppressions="# ${approved_suppression_directive}: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash - public test hash"
      ;;
    scripts/ci/vite-generator-check.test.ts)
      expected_suppressions="    // ${approved_suppression_directive}: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag"
      ;;
    *)
      expected_suppressions=''
      ;;
  esac

  actual_suppressions="$(
    LC_ALL=C grep -aF "${suppression_marker}" "${target_path}" || true
  )"
  if [[ "${actual_suppressions}" != "${expected_suppressions}" ]]; then
    printf 'semgrep-check: inline suppression inventory changed: %q\n' \
      "${relative_path}" >&2
    preflight_failed=1
  fi
done < <(list_scan_files)

if ((preflight_failed != 0)); then
  exit 1
fi

if [[ "${mode}" == '--preflight-only' ]]; then
  exit 0
fi

for required_command in docker tar; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "semgrep-check: ${required_command} is required." >&2
    exit 1
  fi
done

# shellcheck source=scripts/ci/docker-resource-ownership.sh
source "${repo_root}/scripts/ci/docker-resource-ownership.sh"

docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
  --user 65532:65532 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 128m \
  --cpus "$(gate_cpus 1)" \
  --pids-limit 32 \
  --mount "type=bind,src=${repo_root}/scripts/ci,dst=/workspace/scripts,readonly" \
  --workdir /workspace/scripts \
  "${SEMGREP_IMAGE}" \
  bash test-semgrep-report-sanitizer.sh

resource_marker="$(mktemp -d "${TMPDIR:-/tmp}/authowl-sdk-semgrep.XXXXXXXX")"
readonly resource_marker
readonly semgrep_run_id="semgrep-${resource_marker##*.}"
scan_volume=''

cleanup_scan_volume() {
  local body_status=$?
  local cleanup_failed=0
  local discovered
  trap - EXIT INT TERM
  set +e
  if [[ -z "${scan_volume}" ]]; then
    if discovered=$(sdk_ci_single_volume "${semgrep_run_id}"); then
      scan_volume="${discovered}"
    else
      cleanup_failed=1
    fi
  fi
  if [[ -n "${scan_volume}" ]] &&
    ! sdk_ci_remove_volume \
      "${scan_volume}" "${semgrep_run_id}" >/dev/null 2>&1; then
    cleanup_failed=1
  fi
  if ! rm -rf "${resource_marker}"; then
    cleanup_failed=1
  fi
  if [[ "${body_status}" -eq 0 && "${cleanup_failed}" -ne 0 ]]; then
    body_status=1
  fi
  if [[ "${cleanup_failed}" -ne 0 ]]; then
    echo 'semgrep-check: confidential scan-volume cleanup failed.' >&2
  fi
  exit "${body_status}"
}
trap cleanup_scan_volume EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

scan_volume="$(
  docker volume create \
    --label "${AUTHOWL_SDK_CI_RUN_LABEL}=${semgrep_run_id}"
)"

# Fetching is isolated from source. The scanner later re-verifies the
# canonical policy and runs without a network.
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 256m \
  --cpus "$(gate_cpus 1)" \
  --pids-limit 64 \
  --env TYPESCRIPT_RULES_CANONICAL_SHA256="${TYPESCRIPT_RULES_CANONICAL_SHA256}" \
  --env OWASP_RULES_CANONICAL_SHA256="${OWASP_RULES_CANONICAL_SHA256}" \
  --mount "type=bind,src=${repo_root}/scripts/ci/semgrep-rules-digest.py,dst=/ci/semgrep-rules-digest.py,readonly" \
  --mount "type=volume,src=${scan_volume},dst=/workspace" \
  "${SEMGREP_IMAGE}" \
  sh -euc '
    mkdir -p /workspace/rules /workspace/src
    python3 -I /ci/semgrep-rules-digest.py --self-test
    curl --fail --silent --show-error \
      --proto "=https" \
      --tlsv1.2 \
      --connect-timeout 10 \
      --max-time 30 \
      --max-filesize 5242880 \
      https://semgrep.dev/c/p/typescript \
      --output /workspace/rules/typescript.yml
    python3 -I /ci/semgrep-rules-digest.py \
      /workspace/rules/typescript.yml \
      "${TYPESCRIPT_RULES_CANONICAL_SHA256}"

    curl --fail --silent --show-error \
      --proto "=https" \
      --tlsv1.2 \
      --connect-timeout 10 \
      --max-time 30 \
      --max-filesize 5242880 \
      https://semgrep.dev/c/p/owasp-top-ten \
      --output /workspace/rules/owasp-top-ten.yml
    python3 -I /ci/semgrep-rules-digest.py \
      /workspace/rules/owasp-top-ten.yml \
      "${OWASP_RULES_CANONICAL_SHA256}"
  '

# Stage only tracked and non-ignored untracked files. The scanner never sees
# the source repository, Git metadata, ignored local secrets, or build output.
list_scan_files |
  COPYFILE_DISABLE=1 tar --null -C "${repo_root}" -T - -cf - |
  docker run --rm -i \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --memory 512m \
    --cpus "$(gate_cpus 1)" \
    --pids-limit 64 \
    --mount "type=volume,src=${scan_volume},dst=/workspace" \
    "${SEMGREP_IMAGE}" \
    sh -euc '
      tar -xf - -C /workspace/src
      printf "%s\n" \
        "# Gate-owned policy: repository ignore files are forbidden." \
        > /workspace/src/.semgrepignore
    '

docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
  --user 65532:65532 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 2g \
  --cpus "$(gate_cpus 2)" \
  --pids-limit 512 \
  --env XDG_CACHE_HOME=/tmp/cache \
  --env SEMGREP_LOG_FILE=/tmp/semgrep.log \
  --env SEMGREP_SETTINGS_FILE=/tmp/semgrep-settings.yml \
  --env SEMGREP_VERSION_CACHE_PATH=/tmp/semgrep-version \
  --env GIT_CONFIG_GLOBAL=/tmp/gitconfig \
  --env TYPESCRIPT_RULES_CANONICAL_SHA256="${TYPESCRIPT_RULES_CANONICAL_SHA256}" \
  --env OWASP_RULES_CANONICAL_SHA256="${OWASP_RULES_CANONICAL_SHA256}" \
  --env MAX_TARGET_BYTES="${MAX_TARGET_BYTES}" \
  --mount "type=volume,src=${scan_volume},dst=/workspace,readonly" \
  --mount "type=bind,src=${repo_root}/scripts/ci/semgrep-rules-digest.py,dst=/ci/semgrep-rules-digest.py,readonly" \
  --workdir /workspace/src \
  "${SEMGREP_IMAGE}" \
  sh -euc '
    python3 -I /ci/semgrep-rules-digest.py \
      /workspace/rules/typescript.yml \
      "${TYPESCRIPT_RULES_CANONICAL_SHA256}"
    python3 -I /ci/semgrep-rules-digest.py \
      /workspace/rules/owasp-top-ten.yml \
      "${OWASP_RULES_CANONICAL_SHA256}"

    umask 077
    scan_status=0
    semgrep scan \
      --config /workspace/rules/typescript.yml \
      --config /workspace/rules/owasp-top-ten.yml \
      --error \
      --strict \
      --metrics off \
      --disable-version-check \
      --project-root /workspace/src \
      --max-target-bytes "${MAX_TARGET_BYTES}" \
      --timeout 10 \
      --timeout-threshold 1 \
      --jobs 2 \
      --json-output /tmp/semgrep-results.json \
      . > /tmp/semgrep-raw.log 2>&1 || scan_status=$?

    exec python3 -I \
      /workspace/src/scripts/ci/sanitize-semgrep-report.py \
      /tmp/semgrep-results.json \
      "${scan_status}"
  '
