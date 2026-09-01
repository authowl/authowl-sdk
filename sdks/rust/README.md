# authowl (Rust)

**[Complete Rust guide](https://authowl.dev/docs/sdks/rust)** ·
**[JWT issuer setup](https://authowl.dev/docs/backend/jwt-issuer)**

Server-side SDK for [AuthOwl](https://authowl.dev), the multi-tenant auth SaaS.

Pure-Rust crypto — no OpenSSL — so it builds and cross-compiles anywhere cargo
does, including musl and scratch containers.

```toml
[dependencies]
authowl = "0.1"
```

This crate is the **relying-party** side of AuthOwl. It never signs anyone in:
your frontend authenticates against the AuthOwl server directly, and this crate
validates what arrives at your backend.

## Verify a token

```rust
use authowl::{Query, StaticKeySource, Verifier};

let issuer = format!("https://api.authowl.dev/api/projects/{project_id}/auth");
let keys = StaticKeySource::from_bytes(&jwks_bytes)?;
let verifier = Verifier::new(issuer, project_id, keys)?;

let verified = verifier.verify(token)?;
println!("{:?} {:?}", verified.subject, verified.membership);
```

Use `verify_at(token, unix_seconds)` to supply the clock explicitly — taking the
timestamp as a parameter rather than injecting a closure keeps the verifier free
of interior mutability and makes tests deterministic.

The general verifier accepts declared session, template, and access tokens,
but rejects ID tokens by default. Access tokens must carry `typ: at+jwt`; every
other token kind must carry `typ: JWT`. Legacy tokens without `token_use` are
tolerated only with `typ: JWT` until strict mode is enabled. Narrow with
`with_token_use(TokenUse::Access)` and enable strict migration with
`with_required_token_use(true)`.

## Authorize a request

`has` is the real authorization primitive. It **fails closed**: an invalid,
tampered, expired, or wrong-audience token returns `false`.
It always requires a session token, so an access, template, or ID token cannot
be used as an organization-authority credential.

```rust
if !verifier.has(token, &Query::permission("org:billing:read")) {
    return Err(Forbidden);
}

// Every Some field must hold (AND):
let query = Query::role("admin")
    .and_permission("org:billing:read")
    .and_team("team_alpha");
```

Configuration mistakes are rejected in `Verifier::new`, so a misconfigured
verifier can never reach the silent-denial path.

`team_id` checks **group membership, not authority** — teams grant nothing on
their own, and a token minted before teams shipped can never satisfy a team
query.

## Read the session cookie

```rust
// `secure` must reflect the SERVER's cookie mode - derive it from the API URL
// scheme (https => true), not from the incoming request.
let name = authowl::session_cookie_name(project_id, true);
```

## Verify a webhook

```rust
use authowl::{verify_webhook, WebhookInput};

let ok = verify_webhook(&WebhookInput {
    // The EXACT request bytes: re-serializing the JSON breaks the HMAC.
    raw_body: &body,
    timestamp: &timestamp_header,
    signature_header: &signature_header,
    secrets: &[current, previous],   // both, during rotation overlap
    now: unix_seconds,
    tolerance_seconds: None,         // None = 300s; Some(0) = exact-second match
})?;
```

`Err` means invalid local configuration only; anything wrong with the untrusted
request is `Ok(false)`.

## Error codes

`VerificationError::code` carries a code shared verbatim with every other
AuthOwl SDK. Match on the code, never the message.

## Conformance

```bash
cargo test
```

Runs the shared 159-vector corpus from `conformance/vectors`. If a case fails,
this implementation has diverged from the contract — the fix belongs in the code,
not the vector. See `conformance/README.md`.

## License

MIT
