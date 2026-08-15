package authowl

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// as is a tiny errors.As shim so errors.go does not need the import.
func as(err error, target any) bool { return errors.As(err, target) }

var (
	publishableKeyPattern = regexp.MustCompile(
		`^(pk_(live|test))_([0-9a-fA-F-]{36})_([A-Za-z0-9]{20,})$`,
	)
	secretKeyPattern = regexp.MustCompile(`^(?i)sk_`)
)

// Environment is the deployment a publishable key belongs to.
type Environment string

const (
	EnvironmentLive Environment = "live"
	EnvironmentTest Environment = "test"
)

// PublishableKey is the decoded form of a pk_live_… / pk_test_… key.
type PublishableKey struct {
	Prefix    string
	Env       Environment
	ProjectID string
}

// ErrSecretKeySupplied is returned when a secret key reaches a function that
// wants a publishable one. This check runs BEFORE any shape validation and is a
// hard rule across every AuthOwl SDK: a leaked `sk_` key is a full compromise of
// the project, so it must never be quietly accepted as a publishable key.
var ErrSecretKeySupplied = errors.New(
	"authowl: a secret key was passed where a publishable key was expected; " +
		"never embed secret keys in client code",
)

// ErrPublishableKeyRequired is returned for an empty key.
var ErrPublishableKeyRequired = errors.New("authowl: publishableKey is required")

// DecodePublishableKey validates a publishable key and extracts its project id.
func DecodePublishableKey(key string) (PublishableKey, error) {
	if key == "" {
		return PublishableKey{}, ErrPublishableKeyRequired
	}
	if secretKeyPattern.MatchString(key) {
		return PublishableKey{}, ErrSecretKeySupplied
	}
	match := publishableKeyPattern.FindStringSubmatch(key)
	if match == nil {
		return PublishableKey{}, fmt.Errorf(
			"authowl: publishableKey is malformed; expected pk_(live|test)_<uuid>_<base62>",
		)
	}
	return PublishableKey{
		Prefix: strings.ToLower(match[1]),
		Env:    Environment(strings.ToLower(match[2])),
		// Lowercased for the same reason as Prefix and Env: the pattern accepts
		// `[0-9a-fA-F-]`, so an upper-case uuid is a VALID key, and returning it
		// verbatim yields an id that never equals the lowercase Postgres `uuid`
		// the server puts in a JWT `aud` or names its session cookie after.
		ProjectID: strings.ToLower(match[3]),
	}, nil
}
