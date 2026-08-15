//! Error types shared across the crate.

use std::fmt;

/// Why a token was refused.
///
/// These codes are shared VERBATIM with every other AuthOwl SDK (see
/// `conformance/vectors/jwt-verify.json`), so a log line from Rust means the
/// same thing as one from Go or TypeScript. Match on the code, never the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorCode {
    TokenVerificationFailed,
    TokenConfigInvalid,
    TokenMalformed,
    TokenAlgorithmUnsupported,
    TokenSignatureInvalid,
    TokenClaimInvalid,
    JwksFetchFailed,
    JwksFetchTimeout,
    JwksHttpError,
    JwksResponseTooLarge,
    JwksDocumentInvalid,
    JwksTooManyKeys,
    JwksKeyInvalid,
    JwksDuplicateKid,
    JwksKeyNotFound,
}

impl ErrorCode {
    /// The wire form of this code, identical across every AuthOwl SDK.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TokenVerificationFailed => "TOKEN_VERIFICATION_FAILED",
            Self::TokenConfigInvalid => "TOKEN_CONFIG_INVALID",
            Self::TokenMalformed => "TOKEN_MALFORMED",
            Self::TokenAlgorithmUnsupported => "TOKEN_ALGORITHM_UNSUPPORTED",
            Self::TokenSignatureInvalid => "TOKEN_SIGNATURE_INVALID",
            Self::TokenClaimInvalid => "TOKEN_CLAIM_INVALID",
            Self::JwksFetchFailed => "JWKS_FETCH_FAILED",
            Self::JwksFetchTimeout => "JWKS_FETCH_TIMEOUT",
            Self::JwksHttpError => "JWKS_HTTP_ERROR",
            Self::JwksResponseTooLarge => "JWKS_RESPONSE_TOO_LARGE",
            Self::JwksDocumentInvalid => "JWKS_DOCUMENT_INVALID",
            Self::JwksTooManyKeys => "JWKS_TOO_MANY_KEYS",
            Self::JwksKeyInvalid => "JWKS_KEY_INVALID",
            Self::JwksDuplicateKid => "JWKS_DUPLICATE_KID",
            Self::JwksKeyNotFound => "JWKS_KEY_NOT_FOUND",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A project JWT, or the JWKS backing it, was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationError {
    pub code: ErrorCode,
    pub message: String,
}

impl VerificationError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for VerificationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "authowl: {} ({})", self.message, self.code)
    }
}

impl std::error::Error for VerificationError {}

/// A publishable key could not be decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyError {
    /// An empty key was supplied.
    Required,
    /// A `sk_` key reached a function that expects a publishable one.
    ///
    /// Its own variant, not a flavour of `Malformed`: a leaked secret key
    /// compromises the whole project, so the fix is to rotate it rather than
    /// correct a typo, and callers should be able to branch on that.
    SecretKeySupplied,
    /// The key did not match `pk_(live|test)_<uuid>_<base62>`.
    Malformed,
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Required => f.write_str("authowl: publishable key is required"),
            Self::SecretKeySupplied => f.write_str(
                "authowl: a secret key was passed where a publishable key was expected; \
                 never embed secret keys in client code",
            ),
            Self::Malformed => f.write_str(
                "authowl: publishable key is malformed; expected pk_(live|test)_<uuid>_<base62>",
            ),
        }
    }
}

impl std::error::Error for KeyError {}

/// Local webhook configuration is wrong.
///
/// A distinct error rather than a `false` return: untrusted input should be
/// rejected quietly, but a misconfigured endpoint silently dropping every
/// delivery is a bug that must be loud.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WebhookConfigError;

impl fmt::Display for WebhookConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("authowl: invalid webhook verification config")
    }
}

impl std::error::Error for WebhookConfigError {}
