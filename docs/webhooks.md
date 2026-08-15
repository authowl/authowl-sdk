# Verify AuthOwl webhooks

AuthOwl signs the exact bytes sent to your endpoint. Verify the signature
before parsing JSON or performing any work.

Each request includes:

- `AuthOwl-Webhook-Id`: stable event ID
- `AuthOwl-Webhook-Attempt`: unique delivery-attempt ID
- `AuthOwl-Webhook-Timestamp`: Unix seconds used in the signature
- `AuthOwl-Webhook-Signature`: one or more comma-separated `v1=<hex>` values

The signed message is:

```text
<timestamp>.<raw request body>
```

The digest is HMAC-SHA256 using the endpoint's `whsec_...` secret. During the
24-hour rotation overlap, AuthOwl sends signatures from both the new and old
secrets. Accept the request when any supplied `v1` signature matches an active
secret.

Also reject timestamps outside a short tolerance, such as five minutes, and
deduplicate work using `AuthOwl-Webhook-Id`. Timestamp validation limits replay
time; event-ID deduplication prevents repeated work from normal delivery
retries and manual replays.

## Node.js

```ts
import { verifyWebhook } from '@authowl/core/server';

const rawBody = new Uint8Array(await request.arrayBuffer());
const verified = await verifyWebhook({
  rawBody,
  timestamp: request.headers.get('AuthOwl-Webhook-Timestamp') ?? '',
  signatureHeader: request.headers.get('AuthOwl-Webhook-Signature') ?? '',
  secrets: [process.env.AUTHOWL_WEBHOOK_SECRET!],
});

if (!verified) return new Response('Invalid signature', { status: 400 });
const event = JSON.parse(new TextDecoder().decode(rawBody));
```

The server-only helper uses Web Crypto, so the same subpath works in Node and
worker runtimes. It bounds the raw body, timestamp skew, signature count, and
rotation secrets. Invalid request headers return `false`; invalid local secret
configuration throws loudly. Read the raw bytes first. Do not call a JSON body
parser and then serialize the parsed value again.

## Python

```python
import hashlib
import hmac
import time


def verify_authowl_webhook(raw_body, timestamp_header, signature_header, secrets, now=None):
    try:
        timestamp = int(timestamp_header)
    except (TypeError, ValueError):
        return False

    current = int(time.time()) if now is None else now
    if abs(current - timestamp) > 300:
        return False

    candidates = [value.strip() for value in signature_header.split(",")]
    signed = str(timestamp).encode() + b"." + raw_body
    for secret in secrets:
        digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        expected = "v1=" + digest
        if any(hmac.compare_digest(expected, candidate) for candidate in candidates):
            return True
    return False
```

Pass the framework's original request bytes as `raw_body`.

## Shell with OpenSSL

This example verifies a saved raw payload against one active secret. It checks
every signature in the header, which also handles rotation overlap.

```bash
raw_body=payload.json
timestamp="$AUTHOWL_WEBHOOK_TIMESTAMP"
signature_header="$AUTHOWL_WEBHOOK_SIGNATURE"
secret="$AUTHOWL_WEBHOOK_SECRET"

expected="v1=$(
  { printf '%s.' "$timestamp"; cat "$raw_body"; } |
    openssl dgst -sha256 -hmac "$secret" -hex |
    sed 's/^.*= //'
)"

verified=false
old_ifs=$IFS
IFS=,
for candidate in $signature_header; do
  candidate=$(printf '%s' "$candidate" | tr -d '[:space:]')
  if [ "$candidate" = "$expected" ]; then
    verified=true
    break
  fi
done
IFS=$old_ifs

[ "$verified" = true ] || { echo 'invalid AuthOwl webhook signature' >&2; exit 1; }
```

For an application endpoint, prefer a language implementation with a
constant-time comparison. The shell example is intended for diagnostics and
manual verification.
