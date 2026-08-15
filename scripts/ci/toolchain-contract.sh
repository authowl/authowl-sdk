#!/usr/bin/env bash

# Bracket ranges below are matched in the C locale on purpose. Under a UTF-8
# collation locale bash expands `a-f` in collation order - which interleaves
# case - so `[!0-9a-f]` stops rejecting `A-F` and a digest pinned as
# `sha256:AAAA...` validates. That is exactly what these pins exist to prevent,
# and it made the pin checker's verdict depend on the developer's LANG: correct
# on CI (C locale), wrong on a stock macOS shell.
sdk_ci_check_image() {
  local LC_ALL=C
  local value=$1
  local expected_repository=$2
  local digest=${value##*@sha256:}
  if [[ "$value" != "${expected_repository}@sha256:${digest}" ||
        "${#digest}" -ne 64 ]]; then
    return 1
  fi
  case "$digest" in
    *[!0-9a-f]*) return 1 ;;
  esac
}

sdk_ci_check_version() {
  local LC_ALL=C
  local value=${1#v}
  case "$value" in
    *[!0-9.]* | .* | *. | *..* | *.*.*.*) return 1 ;;
    *.*.*) return 0 ;;
    *) return 1 ;;
  esac
}

sdk_ci_load_toolchain() {
  local contract_file=$1
  local line
  local key
  local value
  local seen=' '
  local pnpm_digest

  NODE_BASE_IMAGE=''
  PLAYWRIGHT_BASE_IMAGE=''
  GITLEAKS_IMAGE=''
  NODE_VERSION=''
  PNPM_VERSION=''
  PNPM_INTEGRITY=''

  while IFS= read -r line || [[ -n "$line" ]]; do
    key=${line%%=*}
    value=${line#*=}
    if [[ "$key" == "$line" || -z "$key" || -z "$value" ]]; then
      echo 'SDK CI: malformed toolchain contract entry' >&2
      return 1
    fi
    case " $seen " in
      *" $key "*)
        echo "SDK CI: duplicate toolchain contract key: $key" >&2
        return 1
        ;;
    esac
    case "$key" in
      NODE_BASE_IMAGE) NODE_BASE_IMAGE=$value ;;
      PLAYWRIGHT_BASE_IMAGE) PLAYWRIGHT_BASE_IMAGE=$value ;;
      GITLEAKS_IMAGE) GITLEAKS_IMAGE=$value ;;
      NODE_VERSION) NODE_VERSION=$value ;;
      PNPM_VERSION) PNPM_VERSION=$value ;;
      PNPM_INTEGRITY) PNPM_INTEGRITY=$value ;;
      *)
        echo "SDK CI: unknown toolchain contract key: $key" >&2
        return 1
        ;;
    esac
    seen="$seen$key "
  done <"$contract_file"

  if ! sdk_ci_check_image "$NODE_BASE_IMAGE" node; then
    echo 'SDK CI: invalid Node image pin' >&2
    return 1
  fi
  if ! sdk_ci_check_image \
    "$PLAYWRIGHT_BASE_IMAGE" mcr.microsoft.com/playwright; then
    echo 'SDK CI: invalid Playwright image pin' >&2
    return 1
  fi
  if ! sdk_ci_check_image \
    "$GITLEAKS_IMAGE" ghcr.io/gitleaks/gitleaks; then
    echo 'SDK CI: invalid Gitleaks image pin' >&2
    return 1
  fi
  if [[ "$NODE_VERSION" != v* ]] ||
    ! sdk_ci_check_version "$NODE_VERSION"; then
    echo 'SDK CI: invalid Node version pin' >&2
    return 1
  fi
  if ! sdk_ci_check_version "$PNPM_VERSION"; then
    echo 'SDK CI: invalid pnpm version pin' >&2
    return 1
  fi
  pnpm_digest=${PNPM_INTEGRITY#sha512-}
  if [[ "$pnpm_digest" == "$PNPM_INTEGRITY" ||
        ! "$pnpm_digest" =~ ^[A-Za-z0-9+/]{86}==$ ]]; then
    echo 'SDK CI: invalid pnpm integrity pin' >&2
    return 1
  fi

  readonly NODE_BASE_IMAGE
  readonly PLAYWRIGHT_BASE_IMAGE
  readonly GITLEAKS_IMAGE
  readonly NODE_VERSION
  readonly PNPM_VERSION
  readonly PNPM_INTEGRITY
}
