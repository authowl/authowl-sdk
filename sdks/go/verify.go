package authowl

import (
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"regexp"
	"strings"
	"time"
)

var (
	segmentPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	signaturePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{86}$`)
)

// DefaultClockTolerance is the skew allowed on exp/nbf when none is configured.
const DefaultClockTolerance = 60 * time.Second

// MaxClockTolerance caps the configurable skew. A tolerance larger than this
// keeps revoked tokens alive too long to be called authorization.
const MaxClockTolerance = 300 * time.Second

// VerifiedToken is the result of a successful verification.
type VerifiedToken struct {
	// Subject is the signed-in user id, or "" when the token carries no `sub`.
	Subject string
	// Membership is the active-org membership, or nil when the token carries none.
	Membership *Membership
	// Claims is the full verified claim set, for callers reading extra claims.
	Claims map[string]any
}

// KeySource resolves the verification key named by a token's `kid`.
type KeySource interface {
	// ResolveKey returns the key for kid, or the first published key when kid is
	// empty. It must return a *VerificationError with ErrJWKSKeyNotFound when no
	// key matches.
	ResolveKey(ctx context.Context, kid string) (*JWK, error)
}

// Verifier performs stateless verification of AuthOwl project JWTs.
//
// This is the REAL server-side authorization primitive. It verifies the ES256
// signature against the project's published JWKS and checks issuer, audience,
// and expiry BEFORE reading any claim, so no permission is ever granted off an
// unverified claim.
type Verifier struct {
	// Issuer is the expected `iss`: the project's AuthOwl auth base URL.
	Issuer string
	// Audience is the expected `aud`: the project id.
	Audience string
	// Keys resolves verification keys. Use NewRemoteKeySource in production.
	Keys KeySource
	// ClockTolerance bounds exp/nbf skew, from 0 through MaxClockTolerance.
	//
	// A POINTER so "unset" and "explicitly zero" stay distinct: nil means
	// DefaultClockTolerance, while ClockSkew(0) demands an exact match. A plain
	// duration would let Go's zero value turn the strictest setting into the
	// default one.
	ClockTolerance *time.Duration
	// Now is injectable for deterministic tests. Nil means time.Now.
	Now func() time.Time
}

// ClockSkew returns a pointer for Verifier.ClockTolerance.
func ClockSkew(d time.Duration) *time.Duration { return &d }

func (v *Verifier) now() time.Time {
	if v.Now != nil {
		return v.Now()
	}
	return time.Now()
}

func (v *Verifier) tolerance() time.Duration {
	if v.ClockTolerance == nil {
		return DefaultClockTolerance
	}
	return *v.ClockTolerance
}

func decodeSegment(segment string) (map[string]any, error) {
	malformed := verr(ErrTokenMalformed, "malformed JWT segment")
	if !segmentPattern.MatchString(segment) {
		return nil, malformed
	}
	raw, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return nil, malformed
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil || claims == nil {
		return nil, malformed
	}
	return claims, nil
}

func audienceMatches(aud any, expected string) bool {
	switch value := aud.(type) {
	case string:
		return value == expected
	case []any:
		for _, entry := range value {
			if text, ok := entry.(string); ok && text == expected {
				return true
			}
		}
	}
	return false
}

func stringSlice(value any) ([]string, bool) {
	entries, ok := value.([]any)
	if !ok {
		return nil, false
	}
	// Non-string entries are DROPPED rather than failing the whole claim, so one
	// malformed entry cannot deny an otherwise valid membership.
	result := make([]string, 0, len(entries))
	for _, entry := range entries {
		if text, ok := entry.(string); ok {
			result = append(result, text)
		}
	}
	return result, true
}

func readMembership(claims map[string]any) *Membership {
	raw, ok := claims["membership"].(map[string]any)
	if !ok {
		return nil
	}
	role, _ := raw["role"].(string)
	permissions, _ := stringSlice(raw["permissions"])
	if permissions == nil {
		permissions = []string{}
	}
	// Absent stays nil rather than becoming an empty slice, so Has({TeamID}) can
	// never be satisfied by a claim that never mentioned teams.
	teams, hasTeams := stringSlice(raw["teams"])
	if !hasTeams {
		teams = nil
	}
	if role == "" && len(permissions) == 0 && len(teams) == 0 {
		return nil
	}
	return &Membership{Role: role, Permissions: permissions, Teams: teams}
}

// Verify checks a project JWT and returns its subject, membership, and claims.
//
// Checks run in a deliberate order - structure, algorithm, key, signature, then
// claims - so a token with a bad signature always reports as a signature
// failure even when its claims are also invalid.
func (v *Verifier) Verify(ctx context.Context, token string) (*VerifiedToken, error) {
	if v.Issuer == "" || v.Audience == "" || v.Keys == nil {
		return nil, verr(ErrTokenConfigInvalid, "verifier requires Issuer, Audience, and Keys")
	}
	if v.ClockTolerance != nil && (*v.ClockTolerance < 0 || *v.ClockTolerance > MaxClockTolerance) {
		return nil, verr(ErrTokenConfigInvalid, "ClockTolerance must be between 0 and 300 seconds")
	}
	if token == "" {
		return nil, verr(ErrTokenMalformed, "a token string is required")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, verr(ErrTokenMalformed, "malformed JWT")
	}
	headerSegment, payloadSegment, signatureSegment := parts[0], parts[1], parts[2]

	header, err := decodeSegment(headerSegment)
	if err != nil {
		return nil, err
	}
	// The algorithm is pinned BEFORE key resolution, which is what defeats the
	// `alg: none` and HS256-confusion families outright.
	if alg, _ := header["alg"].(string); alg != "ES256" {
		return nil, verr(ErrTokenAlgorithmUnsupported, "unsupported JWT algorithm")
	}
	kid, _ := header["kid"].(string)

	key, err := v.Keys.ResolveKey(ctx, kid)
	if err != nil {
		return nil, err
	}
	if key == nil || key.public == nil {
		return nil, verr(ErrJWKSKeyNotFound, "no matching JWKS key for the token kid")
	}

	if !signaturePattern.MatchString(signatureSegment) {
		return nil, verr(ErrTokenMalformed, "malformed JWT signature")
	}
	signature, decodeErr := base64.RawURLEncoding.DecodeString(signatureSegment)
	if decodeErr != nil || len(signature) != 64 {
		return nil, verr(ErrTokenMalformed, "malformed JWT signature")
	}

	digest := sha256.Sum256([]byte(headerSegment + "." + payloadSegment))
	r := new(big.Int).SetBytes(signature[:32])
	s := new(big.Int).SetBytes(signature[32:])
	if !ecdsa.Verify(key.public, digest[:], r, s) {
		return nil, verr(ErrTokenSignatureInvalid, "invalid token signature")
	}

	claims, err := decodeSegment(payloadSegment)
	if err != nil {
		return nil, err
	}

	now := v.now().Unix()
	tolerance := int64(v.tolerance() / time.Second)

	// `exp` is REQUIRED, not skip-if-absent: a token with no expiry would never
	// fail closed on its own.
	exp, ok := claims["exp"].(float64)
	if !ok {
		return nil, verr(ErrTokenClaimInvalid, "token is missing a valid exp claim")
	}
	if int64(exp)+tolerance < now {
		return nil, verr(ErrTokenClaimInvalid, "token has expired")
	}
	if nbf, present := claims["nbf"].(float64); present && int64(nbf)-tolerance > now {
		return nil, verr(ErrTokenClaimInvalid, "token is not yet valid")
	}
	// `iss` is REQUIRED and must match exactly - including the trailing slash.
	if iss, _ := claims["iss"].(string); iss != v.Issuer {
		return nil, verr(ErrTokenClaimInvalid, "token issuer missing or mismatched")
	}
	if !audienceMatches(claims["aud"], v.Audience) {
		return nil, verr(ErrTokenClaimInvalid, "token audience mismatch")
	}

	subject, _ := claims["sub"].(string)
	return &VerifiedToken{
		Subject:    subject,
		Membership: readMembership(claims),
		Claims:     claims,
	}, nil
}

// Has verifies the token and evaluates the query against its membership.
//
// Fails CLOSED: an invalid, tampered, expired, or wrong-audience token returns
// false rather than an error, so a caller that ignores errors still denies.
// Configuration mistakes are the exception - those return an error, because a
// misconfigured backend silently denying every request is far worse to debug.
func (v *Verifier) Has(ctx context.Context, token string, query Query) (bool, error) {
	if v.Issuer == "" || v.Audience == "" || v.Keys == nil {
		return false, verr(ErrTokenConfigInvalid, "verifier requires Issuer, Audience, and Keys")
	}
	verified, err := v.Verify(ctx, token)
	if err != nil {
		if CodeOf(err) == ErrTokenConfigInvalid {
			return false, err
		}
		return false, nil
	}
	return verified.Membership.Has(query), nil
}

// HasPermission verifies the token and reports whether it grants permission.
// Fails closed exactly like Has.
func (v *Verifier) HasPermission(ctx context.Context, token, permission string) (bool, error) {
	return v.Has(ctx, token, Query{Permission: Match(permission)})
}
