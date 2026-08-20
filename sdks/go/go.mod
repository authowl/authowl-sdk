// The AuthOwl Go SDK deliberately has NO third-party dependencies: every
// primitive it needs (P-256 ECDSA, HMAC-SHA256, JSON, HTTP) is in the standard
// library. Backend auth is exactly where a surprise transitive dependency is
// least welcome, so keep this file free of `require` directives.
module github.com/authowl/authowl-sdk/sdks/go

go 1.22
