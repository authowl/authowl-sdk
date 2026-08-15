#!/usr/bin/env bash
# Cross-check the SDK reference plus Python and OpenSSL algorithms in the guide.
set -euo pipefail
cd "$(dirname "$0")/../.."

SECRET='whsec_test_vector'
TIMESTAMP='1700000000'
BODY='{"id":"evt_1","type":"user.created"}'
EXPECTED='v1=cb50321336e047cf5457e46cdfe34f5e6e8581d74dd831382822816ffcaa622c'
SIGNATURES="v1=0000000000000000000000000000000000000000000000000000000000000000,$EXPECTED"

grep -Fq "import { verifyWebhook } from '@authowl/core/server';" docs/webhooks.md

AUTHOWL_TEST_SECRET="$SECRET" \
AUTHOWL_TEST_TIMESTAMP="$TIMESTAMP" \
AUTHOWL_TEST_BODY="$BODY" \
AUTHOWL_TEST_SIGNATURES="$SIGNATURES" \
python3 <<'PY'
import hashlib
import hmac
import os


def verify(raw_body, timestamp_header, signature_header, secrets, now):
    try:
        timestamp = int(timestamp_header)
    except (TypeError, ValueError):
        return False
    if abs(now - timestamp) > 300:
        return False
    candidates = [value.strip() for value in signature_header.split(",")]
    signed = str(timestamp).encode() + b"." + raw_body
    return any(
        any(hmac.compare_digest("v1=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest(), candidate)
            for candidate in candidates)
        for secret in secrets
    )


timestamp = os.environ["AUTHOWL_TEST_TIMESTAMP"]
args = (
    os.environ["AUTHOWL_TEST_BODY"].encode(),
    timestamp,
    os.environ["AUTHOWL_TEST_SIGNATURES"],
    [os.environ["AUTHOWL_TEST_SECRET"]],
)
assert verify(*args, int(timestamp))
assert not verify(*args, int(timestamp) + 301)
PY

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
printf '%s' "$BODY" > "$WORK/payload.json"
actual="v1=$(
  { printf '%s.' "$TIMESTAMP"; cat "$WORK/payload.json"; } |
    openssl dgst -sha256 -hmac "$SECRET" -hex |
    sed 's/^.*= //'
)"
[ "$actual" = "$EXPECTED" ]

verified=false
while IFS= read -r candidate; do
  candidate=$(printf '%s' "$candidate" | tr -d '[:space:]')
  if [ "$candidate" = "$actual" ]; then
    verified=true
    break
  fi
done < <(printf '%s\n' "$SIGNATURES" | tr ',' '\n')
[ "$verified" = true ]

echo "webhook-doc-examples-check: OK (SDK helper reference, Python, and raw OpenSSL payload)"
