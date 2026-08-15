//! Stateless verification of AuthOwl project JWTs.
//!
//! This is the REAL server-side authorization primitive. It verifies the ES256
//! signature against the project's published JWKS and checks issuer, audience,
//! and expiry BEFORE reading any claim, so no permission is ever granted off an
//! unverified claim.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use p256::ecdsa::signature::Verifier as _;
use p256::ecdsa::Signature;
use serde_json::{Map, Value};

use crate::error::{ErrorCode, VerificationError};
use crate::jwks::{is_base64url_byte, KeySource};
use crate::membership::{Membership, Query};

/// Skew allowed on `exp`/`nbf` when none is configured.
pub const DEFAULT_CLOCK_TOLERANCE_SECONDS: u64 = 60;
/// A tolerance beyond this keeps revoked tokens alive too long to be called
/// authorization, so it is refused as a configuration error.
pub const MAX_CLOCK_TOLERANCE_SECONDS: u64 = 300;

/// The result of a successful verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedToken {
    /// The signed-in user id, or `None` when the token carries no `sub`.
    pub subject: Option<String>,
    /// The active-org membership, or `None` when the token carries none.
    pub membership: Option<Membership>,
    /// The full verified claim set, for callers reading additional claims.
    pub claims: Map<String, Value>,
}

/// Verifies AuthOwl project JWTs against a project's published keys.
pub struct Verifier<K: KeySource> {
    issuer: String,
    audience: String,
    keys: K,
    clock_tolerance_seconds: u64,
}

// Hand-written so a `KeySource` need not be `Debug` itself, and so the key
// material behind it never reaches a log line.
impl<K: KeySource> std::fmt::Debug for Verifier<K> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Verifier")
            .field("issuer", &self.issuer)
            .field("audience", &self.audience)
            .field("clock_tolerance_seconds", &self.clock_tolerance_seconds)
            .finish_non_exhaustive()
    }
}

impl<K: KeySource> Verifier<K> {
    /// Build a verifier. Fails when the configuration itself is unusable.
    pub fn new(
        issuer: impl Into<String>,
        audience: impl Into<String>,
        keys: K,
    ) -> Result<Self, VerificationError> {
        Self::with_clock_tolerance(issuer, audience, keys, DEFAULT_CLOCK_TOLERANCE_SECONDS)
    }

    pub fn with_clock_tolerance(
        issuer: impl Into<String>,
        audience: impl Into<String>,
        keys: K,
        clock_tolerance_seconds: u64,
    ) -> Result<Self, VerificationError> {
        let issuer = issuer.into();
        let audience = audience.into();
        if issuer.is_empty() || audience.is_empty() {
            return Err(VerificationError::new(
                ErrorCode::TokenConfigInvalid,
                "verifier requires an issuer and an audience",
            ));
        }
        if clock_tolerance_seconds > MAX_CLOCK_TOLERANCE_SECONDS {
            return Err(VerificationError::new(
                ErrorCode::TokenConfigInvalid,
                "clock tolerance must be from 0 through 300 seconds",
            ));
        }
        Ok(Self {
            issuer,
            audience,
            keys,
            clock_tolerance_seconds,
        })
    }

    /// Verify a token against the system clock.
    pub fn verify(&self, token: &str) -> Result<VerifiedToken, VerificationError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs() as i64)
            .unwrap_or(0);
        self.verify_at(token, now)
    }

    /// Verify a token against an explicit Unix timestamp.
    ///
    /// Taking the clock as a parameter rather than injecting a closure keeps the
    /// verifier free of interior mutability and makes tests deterministic.
    ///
    /// Checks run in a deliberate order - structure, algorithm, key, signature,
    /// then claims - so a token with a bad signature always reports as a
    /// signature failure even when its claims are also invalid.
    pub fn verify_at(&self, token: &str, now: i64) -> Result<VerifiedToken, VerificationError> {
        if token.is_empty() {
            return Err(VerificationError::new(
                ErrorCode::TokenMalformed,
                "a token string is required",
            ));
        }
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(VerificationError::new(
                ErrorCode::TokenMalformed,
                "malformed JWT",
            ));
        }
        let (header_segment, payload_segment, signature_segment) = (parts[0], parts[1], parts[2]);

        let header = decode_segment(header_segment)?;
        // The algorithm is pinned BEFORE key resolution, which is what defeats
        // the `alg: none` and HS256-confusion families outright.
        if header.get("alg").and_then(Value::as_str) != Some("ES256") {
            return Err(VerificationError::new(
                ErrorCode::TokenAlgorithmUnsupported,
                "unsupported JWT algorithm",
            ));
        }
        let kid = header.get("kid").and_then(Value::as_str);
        let key = self.keys.resolve_key(kid)?;

        let malformed_signature =
            || VerificationError::new(ErrorCode::TokenMalformed, "malformed JWT signature");
        if signature_segment.len() != 86 || !signature_segment.bytes().all(is_base64url_byte) {
            return Err(malformed_signature());
        }
        let raw_signature = URL_SAFE_NO_PAD
            .decode(signature_segment)
            .map_err(|_| malformed_signature())?;
        if raw_signature.len() != 64 {
            return Err(malformed_signature());
        }
        let signature = Signature::from_slice(&raw_signature).map_err(|_| malformed_signature())?;

        let signing_input = format!("{header_segment}.{payload_segment}");
        key.verifying_key()
            .verify(signing_input.as_bytes(), &signature)
            .map_err(|_| {
                VerificationError::new(ErrorCode::TokenSignatureInvalid, "invalid token signature")
            })?;

        let claims = decode_segment(payload_segment)?;
        let tolerance = self.clock_tolerance_seconds as i64;

        // `exp` is REQUIRED, not skip-if-absent: a token with no expiry would
        // never fail closed on its own.
        let exp = numeric_claim(claims.get("exp")).ok_or_else(|| {
            VerificationError::new(
                ErrorCode::TokenClaimInvalid,
                "token is missing a valid exp claim",
            )
        })?;
        if exp + tolerance < now {
            return Err(VerificationError::new(
                ErrorCode::TokenClaimInvalid,
                "token has expired",
            ));
        }
        if let Some(nbf) = numeric_claim(claims.get("nbf")) {
            if nbf - tolerance > now {
                return Err(VerificationError::new(
                    ErrorCode::TokenClaimInvalid,
                    "token is not yet valid",
                ));
            }
        }
        // `iss` is REQUIRED and must match exactly - including any trailing slash.
        if claims.get("iss").and_then(Value::as_str) != Some(self.issuer.as_str()) {
            return Err(VerificationError::new(
                ErrorCode::TokenClaimInvalid,
                "token issuer missing or mismatched",
            ));
        }
        if !audience_matches(claims.get("aud"), &self.audience) {
            return Err(VerificationError::new(
                ErrorCode::TokenClaimInvalid,
                "token audience mismatch",
            ));
        }

        Ok(VerifiedToken {
            subject: claims.get("sub").and_then(Value::as_str).map(str::to_owned),
            membership: Membership::from_claim(claims.get("membership")),
            claims,
        })
    }

    /// Verify the token, then evaluate the query against its membership.
    ///
    /// Fails CLOSED: an invalid, tampered, expired, or wrong-audience token
    /// returns `false` rather than an error. Configuration mistakes are rejected
    /// in [`Verifier::new`], so a misconfigured verifier can never reach this
    /// silent-denial path.
    pub fn has(&self, token: &str, query: &Query<'_>) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs() as i64)
            .unwrap_or(0);
        self.has_at(token, query, now)
    }

    pub fn has_at(&self, token: &str, query: &Query<'_>, now: i64) -> bool {
        match self.verify_at(token, now) {
            Ok(verified) => verified.membership.is_some_and(|m| m.has(query)),
            Err(_) => false,
        }
    }

    /// Verify the token and report whether it grants `permission`. Fails closed.
    pub fn has_permission(&self, token: &str, permission: &str) -> bool {
        self.has(token, &Query::permission(permission))
    }
}

fn decode_segment(segment: &str) -> Result<Map<String, Value>, VerificationError> {
    let malformed = || VerificationError::new(ErrorCode::TokenMalformed, "malformed JWT segment");
    if segment.is_empty() || !segment.bytes().all(is_base64url_byte) {
        return Err(malformed());
    }
    let raw = URL_SAFE_NO_PAD.decode(segment).map_err(|_| malformed())?;
    let value: Value = serde_json::from_slice(&raw).map_err(|_| malformed())?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(malformed()),
    }
}

/// Read a numeric claim.
///
/// `serde_json` keeps booleans out of `as_f64`, so `"exp": true` correctly
/// reports as absent rather than sliding through as the number 1.
fn numeric_claim(value: Option<&Value>) -> Option<i64> {
    value?.as_f64().map(|number| number as i64)
}

fn audience_matches(aud: Option<&Value>, expected: &str) -> bool {
    match aud {
        Some(Value::String(value)) => value == expected,
        Some(Value::Array(entries)) => entries.iter().any(|entry| entry.as_str() == Some(expected)),
        _ => false,
    }
}
