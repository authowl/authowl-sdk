# authowl (Python)

**[Complete Python guide](https://authowl.dev/docs/sdks/python)** ·
**[JWT issuer setup](https://authowl.dev/docs/backend/jwt-issuer)**

Server-side SDK for [AuthOwl](https://authowl.dev), the multi-tenant auth SaaS.

This package is the **relying-party** side of AuthOwl. It never signs anyone in:
your frontend authenticates against the AuthOwl server directly, and this SDK
validates what arrives at your backend.

```bash
pip install authowl
```

## Verify a token

```python
from authowl import Verifier, RemoteKeySource

PROJECT_ID = "2f1c9a84-..."
ISSUER = f"https://api.authowl.dev/api/projects/{PROJECT_ID}/auth"

verifier = Verifier(
    issuer=ISSUER,
    audience=PROJECT_ID,
    keys=RemoteKeySource(f"{ISSUER}/jwks"),
)

verified = verifier.verify(token)   # raises TokenVerificationError
print(verified.subject, verified.membership)
```

`RemoteKeySource` caches the project's JWKS for five minutes and survives key
rotation by forcing a single rate-limited refetch when it meets an unknown `kid`.

The general verifier accepts declared session, template, and access tokens,
but rejects ID tokens by default. Access tokens must carry `typ: at+jwt`; every
other token kind must carry `typ: JWT`. Pass `token_use="access"` to narrow a
verifier, then `require_token_use=True` after every issuer emits the claim.
Legacy tokens without `token_use` are tolerated only with `typ: JWT` during
migration.

## Authorize a request

`has()` is the real authorization primitive. It **fails closed**: an invalid,
tampered, expired, or wrong-audience token returns `False` rather than raising,
so a caller that forgets to handle errors still denies.
It always requires a session token, so an access, template, or ID token cannot
be used as an organization-authority credential.

```python
if not verifier.has(token, permission="org:billing:read"):
    raise Forbidden()

verifier.has(token, role="admin")
verifier.has(token, role="admin", permission="org:billing:read")  # AND
```

A misconfigured verifier still raises. That is deliberate: a backend that
silently denies every request because an environment variable is missing is far
harder to debug than one that fails loudly at startup.

`team_id` checks **group membership, not authority** — teams grant nothing on
their own, and a token minted before teams shipped can never satisfy a
`team_id` query.

## Read the session cookie

```python
from authowl import session_cookie_name

# `secure` must reflect the SERVER's cookie mode - derive it from the API URL
# scheme (https => True), not from the local request.
name = session_cookie_name(PROJECT_ID, secure=True)
token = request.cookies.get(name)
```

## Verify a webhook

```python
from authowl import verify_webhook

# raw_body must be the EXACT request bytes: parsing and re-serializing the JSON
# reorders keys and breaks the HMAC.
ok = verify_webhook(
    raw_body=await request.body(),
    timestamp=request.headers["authowl-timestamp"],
    signature_header=request.headers["authowl-signature"],
    secrets=[current_secret, previous_secret],   # both, during rotation overlap
)
```

Returns `False` for anything wrong with the untrusted request, and raises
`ConfigurationError` only for invalid local configuration.

## Framework integration

FastAPI, Django, and Flask helpers live in `authowl.integrations`:

```python
from fastapi import Depends
from authowl.integrations.fastapi import require_permission

@app.get("/billing")
def billing(user=Depends(require_permission("org:billing:read", verifier=verifier))):
    return {"user": user.subject}
```

## Conformance

AuthOwl SDKs run one shared corpus of 159 vectors covering JWT
verification, JWKS hardening, cookie naming, key decoding, membership
evaluation, and webhook signatures. Run it with:

```bash
pytest
```

If a case fails, this implementation has diverged from the contract — the fix
belongs in the code, not the vector. See `conformance/README.md` at the repo
root.

## Dependencies

One: `cryptography`, for P-256 ECDSA verification — the single primitive the
standard library does not provide. HMAC, JSON, and HTTP are all stdlib.

## License

MIT
