package authowl

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strconv"
	"strings"
)

const (
	webhookDefaultTolerance = 300
	webhookMaxTolerance     = 3600
	webhookMaxBodyBytes     = 1024 * 1024
	webhookMaxSignatures    = 4
	webhookMaxSecrets       = 2
	webhookMaxHeaderLength  = 1024
)

var (
	webhookSignaturePattern = regexp.MustCompile(`^(?i)v1=([a-f0-9]{64})$`)
	webhookSecretPattern    = regexp.MustCompile(`^whsec_[A-Za-z0-9_-]{1,256}$`)
	webhookTimestampPattern = regexp.MustCompile(`^(0|[1-9]\d{0,10})$`)
)

// ErrWebhookConfig reports invalid LOCAL configuration - bad secrets or an
// out-of-range tolerance. It is deliberately an error rather than a false
// return: untrusted input should be rejected quietly, but a misconfigured
// endpoint silently dropping every delivery is a bug that must be loud.
var ErrWebhookConfig = errors.New("authowl: invalid webhook verification config")

// WebhookInput is one delivery to verify.
type WebhookInput struct {
	// RawBody must be the EXACT request bytes. Do not parse and re-serialize the
	// JSON before verifying - re-serialization reorders keys and breaks the HMAC.
	RawBody []byte
	// Timestamp is the delivery's timestamp header, as a string.
	Timestamp string
	// SignatureHeader is the delivery's signature header (`v1=<hex>`, comma separated).
	SignatureHeader string
	// Secrets holds the current and, during rotation overlap, the previous secret.
	Secrets []string
	// Now is the current time in Unix seconds.
	Now int64
	// ToleranceSeconds bounds accepted clock skew, from 0 through 3600.
	//
	// A POINTER so that "unset" and "explicitly zero" stay distinct: nil means
	// the 300-second default, while Tolerance(0) demands an exact-second match.
	// With a plain int, Go's zero value would silently turn the strictest
	// setting into the loosest one.
	ToleranceSeconds *int
}

// Tolerance returns a pointer for WebhookInput.ToleranceSeconds.
func Tolerance(seconds int) *int { return &seconds }

// VerifyWebhook reports whether a delivery carries a valid signature.
//
// Returns (false, nil) for anything wrong with the untrusted request, and a
// non-nil error only for invalid local configuration.
func VerifyWebhook(input WebhookInput) (bool, error) {
	if err := validateSecrets(input.Secrets); err != nil {
		return false, err
	}

	tolerance := webhookDefaultTolerance
	if input.ToleranceSeconds != nil {
		tolerance = *input.ToleranceSeconds
		if tolerance < 0 || tolerance > webhookMaxTolerance {
			return false, ErrWebhookConfig
		}
	}

	if len(input.RawBody) > webhookMaxBodyBytes {
		return false, nil
	}
	if !webhookTimestampPattern.MatchString(input.Timestamp) {
		return false, nil
	}
	timestamp, err := strconv.ParseInt(input.Timestamp, 10, 64)
	if err != nil {
		return false, nil
	}
	skew := input.Now - timestamp
	if skew < 0 {
		skew = -skew
	}
	if skew > int64(tolerance) {
		return false, nil
	}

	supplied := parseWebhookSignatures(input.SignatureHeader)
	if len(supplied) == 0 {
		return false, nil
	}

	signed := append([]byte(input.Timestamp+"."), input.RawBody...)
	matched := false
	for _, secret := range input.Secrets {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(signed)
		expected := mac.Sum(nil)
		for _, candidate := range supplied {
			// No early exit: comparing every candidate keeps the work independent
			// of where a match occurs.
			if hmac.Equal(expected, candidate) {
				matched = true
			}
		}
	}
	return matched, nil
}

func validateSecrets(secrets []string) error {
	if len(secrets) < 1 || len(secrets) > webhookMaxSecrets {
		return ErrWebhookConfig
	}
	seen := make(map[string]bool, len(secrets))
	for _, secret := range secrets {
		if !webhookSecretPattern.MatchString(secret) || seen[secret] {
			return ErrWebhookConfig
		}
		seen[secret] = true
	}
	return nil
}

func parseWebhookSignatures(header string) [][]byte {
	if len(header) > webhookMaxHeaderLength {
		return nil
	}
	entries := strings.Split(header, ",")
	if len(entries) > webhookMaxSignatures {
		return nil
	}
	signatures := make([][]byte, 0, len(entries))
	for _, entry := range entries {
		match := webhookSignaturePattern.FindStringSubmatch(strings.TrimSpace(entry))
		if match == nil {
			continue
		}
		raw, err := hex.DecodeString(match[1])
		if err != nil {
			continue
		}
		signatures = append(signatures, raw)
	}
	return signatures
}
