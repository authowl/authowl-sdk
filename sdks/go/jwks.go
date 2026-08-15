package authowl

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"regexp"
)

const (
	maxJWKSKeys = 64
	// jwksMaxBytes bounds the JWKS response so a hostile or misconfigured issuer
	// cannot exhaust memory. Matches the TypeScript SDK's 64 KiB ceiling.
	jwksMaxBytes = 64 * 1024
)

var (
	kidPattern        = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	coordinatePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

	// Members that must never appear on a PUBLIC verification key. `d` is the
	// private scalar; the RSA/oct members are here so a key from the wrong family
	// is refused loudly rather than silently ignored.
	privateJWKMembers = []string{"d", "p", "q", "dp", "dq", "qi", "k", "oth"}
	allowedJWKMembers = map[string]bool{
		"alg": true, "crv": true, "kid": true, "kty": true, "use": true, "x": true, "y": true,
	}
)

// JWK is a published ES256 verification key.
type JWK struct {
	Alg string
	Crv string
	Kid string
	Kty string
	Use string
	X   string
	Y   string

	public *ecdsa.PublicKey
}

// PublicKey returns the parsed P-256 public key.
func (k *JWK) PublicKey() *ecdsa.PublicKey { return k.public }

func decodeCoordinate(value json.RawMessage) ([]byte, bool) {
	var text string
	if err := json.Unmarshal(value, &text); err != nil {
		return nil, false
	}
	if !coordinatePattern.MatchString(text) {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(text)
	if err != nil || len(raw) != 32 {
		return nil, false
	}
	return raw, true
}

func stringMember(members map[string]json.RawMessage, name string) (string, bool) {
	raw, ok := members[name]
	if !ok {
		return "", false
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return "", false
	}
	return text, true
}

// parsePublicES256JWK enforces the AuthOwl public-key schema. Anything outside
// it - a private member, an unexpected member, the wrong curve - is refused
// rather than tolerated, so a compromised or confused JWKS cannot smuggle in a
// key this verifier would trust.
func parsePublicES256JWK(raw json.RawMessage) (*JWK, error) {
	invalid := verr(ErrJWKSKeyInvalid, "JWKS contains a key outside the AuthOwl ES256 public-key schema")

	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil || members == nil {
		return nil, verr(ErrJWKSKeyInvalid, "JWKS contains a non-object key")
	}
	if _, hasKeyOps := members["key_ops"]; hasKeyOps {
		return nil, verr(ErrJWKSKeyInvalid, "JWKS key carries key_ops")
	}
	for _, member := range privateJWKMembers {
		if _, present := members[member]; present {
			return nil, verr(ErrJWKSKeyInvalid, "JWKS key carries private key material")
		}
	}
	for member := range members {
		if !allowedJWKMembers[member] {
			return nil, verr(ErrJWKSKeyInvalid, "JWKS key carries an unexpected member")
		}
	}

	kty, okKty := stringMember(members, "kty")
	crv, okCrv := stringMember(members, "crv")
	alg, okAlg := stringMember(members, "alg")
	use, okUse := stringMember(members, "use")
	kid, okKid := stringMember(members, "kid")
	if !okKty || !okCrv || !okAlg || !okUse || !okKid {
		return nil, invalid
	}
	if kty != "EC" || crv != "P-256" || alg != "ES256" || use != "sig" {
		return nil, invalid
	}
	if len(kid) == 0 || len(kid) > 128 || !kidPattern.MatchString(kid) {
		return nil, invalid
	}

	rawX, okX := members["x"]
	rawY, okY := members["y"]
	if !okX || !okY {
		return nil, invalid
	}
	x, validX := decodeCoordinate(rawX)
	y, validY := decodeCoordinate(rawY)
	if !validX || !validY {
		return nil, invalid
	}

	public := &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(x),
		Y:     new(big.Int).SetBytes(y),
	}
	// Reject a point that is not actually on the curve: an off-curve key can
	// otherwise provoke undefined behaviour in the verifier.
	if !public.Curve.IsOnCurve(public.X, public.Y) {
		return nil, invalid
	}

	xText, _ := stringMember(members, "x")
	yText, _ := stringMember(members, "y")
	return &JWK{
		Alg: alg, Crv: crv, Kid: kid, Kty: kty, Use: use,
		X: xText, Y: yText, public: public,
	}, nil
}

// ParseJWKS validates a JWKS document and returns its verification keys.
//
// The document must be an object whose ONLY member is a `keys` array - extra
// top-level members are refused, not ignored, so an issuer cannot slip
// verifier-affecting metadata past this parser.
func ParseJWKS(document []byte) ([]*JWK, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(document, &top); err != nil || top == nil {
		return nil, verr(ErrJWKSDocumentInvalid,
			"JWKS response must be an object containing only a keys array")
	}
	rawKeys, ok := top["keys"]
	if !ok || len(top) != 1 {
		return nil, verr(ErrJWKSDocumentInvalid,
			"JWKS response must be an object containing only a keys array")
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(rawKeys, &entries); err != nil {
		return nil, verr(ErrJWKSDocumentInvalid, "JWKS keys member must be an array")
	}
	if len(entries) > maxJWKSKeys {
		return nil, verr(ErrJWKSTooManyKeys, "JWKS response exceeds the 64-key limit")
	}

	keys := make([]*JWK, 0, len(entries))
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		key, err := parsePublicES256JWK(entry)
		if err != nil {
			return nil, err
		}
		if seen[key.Kid] {
			return nil, verr(ErrJWKSDuplicateKID, "JWKS response contains duplicate kid values")
		}
		seen[key.Kid] = true
		keys = append(keys, key)
	}
	return keys, nil
}
