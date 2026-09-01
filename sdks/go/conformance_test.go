package authowl

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// The Go SDK runs the SAME vectors as every other AuthOwl SDK. If a case here
// fails, this implementation has diverged from the contract - fix the code, not
// the vector. See conformance/README.md.

func loadVectors(t *testing.T, name string, into any) {
	t.Helper()
	path := filepath.Join("..", "..", "conformance", "vectors", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
}

// normalize round-trips a value through JSON so actual and expected are compared
// in the same shape, independent of Go struct field order or nil-vs-absent.
func normalize(t *testing.T, value any) any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func TestConformanceTokenVerification(t *testing.T) {
	var vectors struct {
		Issuer   string          `json:"issuer"`
		Audience string          `json:"audience"`
		JWKS     json.RawMessage `json:"jwks"`
		Cases    []struct {
			Name                  string `json:"name"`
			Token                 string `json:"token"`
			Now                   int64  `json:"now"`
			ClockToleranceSeconds *int   `json:"clockToleranceSeconds"`
			TokenUse              string `json:"tokenUse"`
			RequireTokenUse       bool   `json:"requireTokenUse"`
			Authorization         *struct {
				Permission string `json:"permission"`
				Expect     bool   `json:"expect"`
			} `json:"authorization"`
			Expect struct {
				OK         bool            `json:"ok"`
				Sub        *string         `json:"sub"`
				Membership json.RawMessage `json:"membership"`
				Code       string          `json:"code"`
			} `json:"expect"`
		} `json:"cases"`
	}
	loadVectors(t, "jwt-verify.json", &vectors)

	keys, err := NewStaticKeySource(vectors.JWKS)
	if err != nil {
		t.Fatalf("parse conformance JWKS: %v", err)
	}

	for _, testCase := range vectors.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			verifier := &Verifier{
				Issuer:   vectors.Issuer,
				Audience: vectors.Audience,
				Keys:     keys,
				Now:      func() time.Time { return time.Unix(testCase.Now, 0) },
			}
			if testCase.ClockToleranceSeconds != nil {
				verifier.ClockTolerance = ClockSkew(
					time.Duration(*testCase.ClockToleranceSeconds) * time.Second,
				)
			}
			verifier.TokenUse = TokenUse(testCase.TokenUse)
			verifier.RequireTokenUse = testCase.RequireTokenUse

			verified, err := verifier.Verify(context.Background(), testCase.Token)

			if !testCase.Expect.OK {
				if err == nil {
					t.Fatalf("expected %s, got a valid token", testCase.Expect.Code)
				}
				if got := string(CodeOf(err)); got != testCase.Expect.Code {
					t.Fatalf("expected code %s, got %s (%v)", testCase.Expect.Code, got, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("expected success, got %v", err)
			}
			wantSub := ""
			if testCase.Expect.Sub != nil {
				wantSub = *testCase.Expect.Sub
			}
			if verified.Subject != wantSub {
				t.Fatalf("subject: want %q, got %q", wantSub, verified.Subject)
			}
			var wantMembership any
			if err := json.Unmarshal(testCase.Expect.Membership, &wantMembership); err != nil {
				t.Fatalf("parse expected membership: %v", err)
			}
			if got := normalize(t, verified.Membership); !reflect.DeepEqual(got, wantMembership) {
				t.Fatalf("membership: want %#v, got %#v", wantMembership, got)
			}
			if testCase.Authorization != nil {
				allowed, err := verifier.Has(
					context.Background(),
					testCase.Token,
					Query{Permission: Match(testCase.Authorization.Permission)},
				)
				if err != nil {
					t.Fatalf("authorization: %v", err)
				}
				if allowed != testCase.Authorization.Expect {
					t.Fatalf("authorization: want %v, got %v", testCase.Authorization.Expect, allowed)
				}
			}
		})
	}
}

func TestTokenUseConfigurationIsValidated(t *testing.T) {
	var vectors struct {
		Issuer   string          `json:"issuer"`
		Audience string          `json:"audience"`
		JWKS     json.RawMessage `json:"jwks"`
	}
	loadVectors(t, "jwt-verify.json", &vectors)
	keys, err := NewStaticKeySource(vectors.JWKS)
	if err != nil {
		t.Fatalf("parse conformance JWKS: %v", err)
	}
	verifier := &Verifier{
		Issuer:   vectors.Issuer,
		Audience: vectors.Audience,
		Keys:     keys,
		TokenUse: TokenUse("refresh"),
	}
	_, err = verifier.Verify(context.Background(), "not-a-token")
	if got := CodeOf(err); got != ErrTokenConfigInvalid {
		t.Fatalf("Verify: want %s, got %s (%v)", ErrTokenConfigInvalid, got, err)
	}
	_, err = verifier.Has(context.Background(), "not-a-token", Query{})
	if got := CodeOf(err); got != ErrTokenConfigInvalid {
		t.Fatalf("Has: want %s, got %s (%v)", ErrTokenConfigInvalid, got, err)
	}
}

func TestConformanceJWKSParsing(t *testing.T) {
	var vectors struct {
		Cases []struct {
			Name     string          `json:"name"`
			Document json.RawMessage `json:"document"`
			Expect   struct {
				OK   bool   `json:"ok"`
				Keys int    `json:"keys"`
				Code string `json:"code"`
			} `json:"expect"`
		} `json:"cases"`
	}
	loadVectors(t, "jwks-parse.json", &vectors)

	for _, testCase := range vectors.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			keys, err := ParseJWKS(testCase.Document)
			if !testCase.Expect.OK {
				if err == nil {
					t.Fatalf("expected %s, got %d keys", testCase.Expect.Code, len(keys))
				}
				if got := string(CodeOf(err)); got != testCase.Expect.Code {
					t.Fatalf("expected code %s, got %s (%v)", testCase.Expect.Code, got, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected success, got %v", err)
			}
			if len(keys) != testCase.Expect.Keys {
				t.Fatalf("keys: want %d, got %d", testCase.Expect.Keys, len(keys))
			}
		})
	}
}

func TestConformanceSessionCookieName(t *testing.T) {
	var vectors struct {
		Cases []struct {
			Name      string `json:"name"`
			ProjectID string `json:"projectId"`
			Secure    *bool  `json:"secure"`
			Expect    string `json:"expect"`
		} `json:"cases"`
	}
	loadVectors(t, "cookie-name.json", &vectors)

	for _, testCase := range vectors.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			secure := testCase.Secure != nil && *testCase.Secure
			if got := SessionCookieName(testCase.ProjectID, secure); got != testCase.Expect {
				t.Fatalf("want %q, got %q", testCase.Expect, got)
			}
		})
	}
}

func TestConformancePublishableKey(t *testing.T) {
	var vectors struct {
		Cases []struct {
			Name   string `json:"name"`
			Key    string `json:"key"`
			Expect struct {
				OK        bool   `json:"ok"`
				Prefix    string `json:"prefix"`
				Env       string `json:"env"`
				ProjectID string `json:"projectId"`
				Reason    string `json:"reason"`
			} `json:"expect"`
		} `json:"cases"`
	}
	loadVectors(t, "publishable-key.json", &vectors)

	// Collapse the Go error to the portable reason every SDK reports.
	reasonOf := func(err error) string {
		switch {
		case errors.Is(err, ErrPublishableKeyRequired):
			return "missing"
		case errors.Is(err, ErrSecretKeySupplied):
			return "secret_key"
		default:
			return "malformed"
		}
	}

	for _, testCase := range vectors.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			decoded, err := DecodePublishableKey(testCase.Key)
			if !testCase.Expect.OK {
				if err == nil {
					t.Fatalf("expected %s, got %+v", testCase.Expect.Reason, decoded)
				}
				if got := reasonOf(err); got != testCase.Expect.Reason {
					t.Fatalf("reason: want %s, got %s (%v)", testCase.Expect.Reason, got, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected success, got %v", err)
			}
			if decoded.Prefix != testCase.Expect.Prefix ||
				string(decoded.Env) != testCase.Expect.Env ||
				decoded.ProjectID != testCase.Expect.ProjectID {
				t.Fatalf("want %s/%s/%s, got %s/%s/%s",
					testCase.Expect.Prefix, testCase.Expect.Env, testCase.Expect.ProjectID,
					decoded.Prefix, decoded.Env, decoded.ProjectID)
			}
		})
	}
}

func TestConformanceMembership(t *testing.T) {
	var vectors struct {
		HasCases []struct {
			Name       string      `json:"name"`
			Membership *Membership `json:"membership"`
			Params     Query       `json:"params"`
			Expect     bool        `json:"expect"`
		} `json:"hasCases"`
		HasPermissionCases []struct {
			Name       string      `json:"name"`
			Membership *Membership `json:"membership"`
			Permission string      `json:"permission"`
			Expect     bool        `json:"expect"`
		} `json:"hasPermissionCases"`
	}
	loadVectors(t, "membership-has.json", &vectors)

	for _, testCase := range vectors.HasCases {
		t.Run("has: "+testCase.Name, func(t *testing.T) {
			got := testCase.Membership.Has(testCase.Params)
			if got != testCase.Expect {
				t.Fatalf("want %v, got %v", testCase.Expect, got)
			}
		})
	}
	for _, testCase := range vectors.HasPermissionCases {
		t.Run("hasPermission: "+testCase.Name, func(t *testing.T) {
			if got := testCase.Membership.HasPermission(testCase.Permission); got != testCase.Expect {
				t.Fatalf("want %v, got %v", testCase.Expect, got)
			}
		})
	}
}

func TestConformanceWebhookVerification(t *testing.T) {
	var vectors struct {
		Cases []struct {
			Name             string   `json:"name"`
			RawBody          string   `json:"rawBody"`
			Timestamp        string   `json:"timestamp"`
			SignatureHeader  string   `json:"signatureHeader"`
			Secrets          []string `json:"secrets"`
			Now              int64    `json:"now"`
			ToleranceSeconds *int     `json:"toleranceSeconds"`
			Expect           struct {
				Result *bool `json:"result"`
				Throws bool  `json:"throws"`
			} `json:"expect"`
		} `json:"cases"`
	}
	loadVectors(t, "webhook-verify.json", &vectors)

	for _, testCase := range vectors.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			ok, err := VerifyWebhook(WebhookInput{
				RawBody:          []byte(testCase.RawBody),
				Timestamp:        testCase.Timestamp,
				SignatureHeader:  testCase.SignatureHeader,
				Secrets:          testCase.Secrets,
				Now:              testCase.Now,
				ToleranceSeconds: testCase.ToleranceSeconds,
			})

			if testCase.Expect.Throws {
				// Local misconfiguration must be LOUD; only untrusted input degrades to false.
				if err == nil {
					t.Fatalf("expected a configuration error, got ok=%v", ok)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if ok != *testCase.Expect.Result {
				t.Fatalf("want %v, got %v", *testCase.Expect.Result, ok)
			}
		})
	}
}
