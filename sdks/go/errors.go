package authowl

import "fmt"

// ErrorCode identifies why a token was refused. The codes are shared verbatim
// with every other AuthOwl SDK (see conformance/vectors/jwt-verify.json), so a
// log line from the Go SDK means the same thing as one from the TypeScript SDK.
type ErrorCode string

const (
	ErrTokenVerificationFailed   ErrorCode = "TOKEN_VERIFICATION_FAILED"
	ErrTokenConfigInvalid        ErrorCode = "TOKEN_CONFIG_INVALID"
	ErrTokenMalformed            ErrorCode = "TOKEN_MALFORMED"
	ErrTokenAlgorithmUnsupported ErrorCode = "TOKEN_ALGORITHM_UNSUPPORTED"
	ErrTokenSignatureInvalid     ErrorCode = "TOKEN_SIGNATURE_INVALID"
	ErrTokenClaimInvalid         ErrorCode = "TOKEN_CLAIM_INVALID"
	ErrTokenUseUnsupported       ErrorCode = "TOKEN_USE_UNSUPPORTED"
	ErrJWKSFetchFailed           ErrorCode = "JWKS_FETCH_FAILED"
	ErrJWKSFetchTimeout          ErrorCode = "JWKS_FETCH_TIMEOUT"
	ErrJWKSHTTPError             ErrorCode = "JWKS_HTTP_ERROR"
	ErrJWKSResponseTooLarge      ErrorCode = "JWKS_RESPONSE_TOO_LARGE"
	ErrJWKSDocumentInvalid       ErrorCode = "JWKS_DOCUMENT_INVALID"
	ErrJWKSTooManyKeys           ErrorCode = "JWKS_TOO_MANY_KEYS"
	ErrJWKSKeyInvalid            ErrorCode = "JWKS_KEY_INVALID"
	ErrJWKSDuplicateKID          ErrorCode = "JWKS_DUPLICATE_KID"
	ErrJWKSKeyNotFound           ErrorCode = "JWKS_KEY_NOT_FOUND"
)

// VerificationError is returned by Verify and the JWKS parser. Match on Code,
// never on Message: the codes are contractual, the messages are not.
type VerificationError struct {
	Code    ErrorCode
	Message string
}

func (e *VerificationError) Error() string {
	return fmt.Sprintf("authowl: %s (%s)", e.Message, e.Code)
}

func verr(code ErrorCode, message string) *VerificationError {
	return &VerificationError{Code: code, Message: message}
}

// CodeOf reports the AuthOwl error code carried by err, or "" if err did not
// come from this package. Handy for structured logging and metrics.
func CodeOf(err error) ErrorCode {
	if err == nil {
		return ""
	}
	var ve *VerificationError
	if as(err, &ve) {
		return ve.Code
	}
	return ""
}
