# AuthOwl Go SDK

**[Complete Go guide](https://authowl.dev/docs/sdks/go)** ·
**[JWT issuer setup](https://authowl.dev/docs/backend/jwt-issuer)**

Server-side SDK for [AuthOwl](https://authowl.dev), the multi-tenant auth SaaS.

**Zero dependencies.** Every primitive it needs — P-256 ECDSA, HMAC-SHA256,
JSON, HTTP — is in the standard library. Backend auth is where a surprise
transitive dependency is least welcome.

```bash
go get github.com/authowl/authowl-sdk/sdks/go
```

This package is the **relying-party** side of AuthOwl. It never signs anyone in:
your frontend authenticates against the AuthOwl server directly, and this SDK
validates what arrives at your backend.

## Verify a token

```go
projectID := "2f1c9a84-..."
issuer := "https://api.authowl.dev/api/projects/" + projectID + "/auth"

verifier := &authowl.Verifier{
    Issuer:   issuer,
    Audience: projectID,
    Keys:     authowl.NewRemoteKeySource(issuer + "/jwks"),
}

verified, err := verifier.Verify(ctx, token)
if err != nil {
    log.Printf("denied: %s", authowl.CodeOf(err))
    return
}
fmt.Println(verified.Subject, verified.Membership)
```

`RemoteKeySource` caches the JWKS for five minutes and survives key rotation by
forcing a single rate-limited refetch when it meets an unknown `kid`.

## Authorize a request

`Has` is the real authorization primitive. It **fails closed**: an invalid,
tampered, expired, or wrong-audience token returns `false`, not an error.

```go
ok, err := verifier.Has(ctx, token, authowl.Query{
    Permission: authowl.Match("org:billing:read"),
})
if err != nil {
    // Only a CONFIGURATION mistake reaches here - a backend that silently denies
    // every request because of a missing env var is far worse to debug.
    http.Error(w, "auth misconfigured", http.StatusInternalServerError)
    return
}
if !ok {
    http.Error(w, "forbidden", http.StatusForbidden)
    return
}
```

Every present field in a `Query` must hold (AND). Use `Match` so an explicit
empty value remains a criterion and fails closed instead of looking omitted:

```go
authowl.Query{
    Role:       authowl.Match("admin"),
    Permission: authowl.Match("org:billing:read"),
    TeamID:     authowl.Match("team_alpha"),
}
```

`TeamID` checks **group membership, not authority** — teams grant nothing on
their own, and a token minted before teams shipped can never satisfy a `TeamID`
query.

## Read the session cookie

```go
// `secure` must reflect the SERVER's cookie mode - derive it from the API URL
// scheme (https => true), not from the incoming request.
name := authowl.SessionCookieName(projectID, true)
cookie, err := r.Cookie(name)
```

## Verify a webhook

```go
body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))

ok, err := authowl.VerifyWebhook(authowl.WebhookInput{
    // The EXACT request bytes: re-serializing the JSON reorders keys and breaks the HMAC.
    RawBody:         body,
    Timestamp:       r.Header.Get("authowl-timestamp"),
    SignatureHeader: r.Header.Get("authowl-signature"),
    Secrets:         []string{current, previous}, // both, during rotation overlap
    Now:             time.Now().Unix(),
})
```

`err` is non-nil only for invalid local configuration; anything wrong with the
untrusted request returns `(false, nil)`.

## Error codes

`CodeOf(err)` returns a code shared verbatim with every other AuthOwl SDK, so a
Go log line means the same thing as a TypeScript one. Match on the code, never
the message.

## Conformance

```bash
go test ./...
```

Runs the shared 125-vector corpus from `conformance/vectors`. If a case fails,
this implementation has diverged from the contract — the fix belongs in the code,
not the vector. See `conformance/README.md`.

## License

MIT
