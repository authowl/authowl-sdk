//! JWKS document parsing and key sources.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use p256::ecdsa::VerifyingKey;
use p256::{EncodedPoint, FieldBytes};
use serde_json::Value;

use crate::error::{ErrorCode, VerificationError};

pub const MAX_JWKS_KEYS: usize = 64;
/// Bound the JWKS response so a hostile or misconfigured issuer cannot exhaust
/// memory. Matches the TypeScript SDK's ceiling.
pub const JWKS_MAX_BYTES: usize = 64 * 1024;

const ALLOWED_MEMBERS: [&str; 7] = ["alg", "crv", "kid", "kty", "use", "x", "y"];
/// `d` is the private scalar; the RSA/oct members are listed so a key from the
/// wrong family is refused loudly rather than silently ignored.
const PRIVATE_MEMBERS: [&str; 8] = ["d", "p", "q", "dp", "dq", "qi", "k", "oth"];

/// A published ES256 verification key.
#[derive(Debug, Clone)]
pub struct Jwk {
    pub kid: String,
    pub x: String,
    pub y: String,
    pub(crate) verifying_key: VerifyingKey,
}

impl Jwk {
    pub fn verifying_key(&self) -> &VerifyingKey {
        &self.verifying_key
    }
}

fn invalid_key() -> VerificationError {
    VerificationError::new(
        ErrorCode::JwksKeyInvalid,
        "JWKS contains a key outside the AuthOwl ES256 public-key schema",
    )
}

fn decode_coordinate(value: Option<&Value>) -> Option<Vec<u8>> {
    let text = value?.as_str()?;
    if text.len() != 43 || !text.bytes().all(is_base64url_byte) {
        return None;
    }
    let raw = URL_SAFE_NO_PAD.decode(text).ok()?;
    (raw.len() == 32).then_some(raw)
}

pub(crate) fn is_base64url_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
}

/// Enforce the AuthOwl public-key schema.
///
/// Anything outside it (a private member, an unexpected member, the wrong curve)
/// is refused rather than tolerated, so a compromised or confused JWKS cannot
/// smuggle in a key this verifier would trust.
fn parse_public_es256_jwk(raw: &Value) -> Result<Jwk, VerificationError> {
    let object = raw.as_object().ok_or_else(|| {
        VerificationError::new(ErrorCode::JwksKeyInvalid, "JWKS contains a non-object key")
    })?;

    if object.contains_key("key_ops")
        || PRIVATE_MEMBERS
            .iter()
            .any(|member| object.contains_key(*member))
    {
        return Err(VerificationError::new(
            ErrorCode::JwksKeyInvalid,
            "JWKS key carries private key material or key_ops",
        ));
    }
    if object
        .keys()
        .any(|member| !ALLOWED_MEMBERS.contains(&member.as_str()))
    {
        return Err(VerificationError::new(
            ErrorCode::JwksKeyInvalid,
            "JWKS key carries an unexpected member",
        ));
    }

    let member = |name: &str| object.get(name).and_then(Value::as_str);
    if member("kty") != Some("EC")
        || member("crv") != Some("P-256")
        || member("alg") != Some("ES256")
        || member("use") != Some("sig")
    {
        return Err(invalid_key());
    }

    let kid = member("kid").ok_or_else(invalid_key)?;
    if kid.is_empty() || kid.len() > 128 || !kid.bytes().all(is_base64url_byte) {
        return Err(invalid_key());
    }

    let x = decode_coordinate(object.get("x")).ok_or_else(invalid_key)?;
    let y = decode_coordinate(object.get("y")).ok_or_else(invalid_key)?;

    // Fixed-size arrays rather than the `GenericArray::from_slice` family, which
    // is deprecated ahead of the generic-array 1.x migration. `decode_coordinate`
    // already guarantees 32 bytes, so these conversions cannot fail.
    let x: [u8; 32] = x.as_slice().try_into().map_err(|_| invalid_key())?;
    let y: [u8; 32] = y.as_slice().try_into().map_err(|_| invalid_key())?;
    let point =
        EncodedPoint::from_affine_coordinates(&FieldBytes::from(x), &FieldBytes::from(y), false);
    // Rejects a point that is not on the curve, which is the check an off-curve
    // key attack needs to trip.
    let verifying_key = VerifyingKey::from_encoded_point(&point).map_err(|_| invalid_key())?;

    Ok(Jwk {
        kid: kid.to_owned(),
        x: member("x").unwrap_or_default().to_owned(),
        y: member("y").unwrap_or_default().to_owned(),
        verifying_key,
    })
}

/// Validate a JWKS document and return its verification keys.
///
/// The document must be an object whose ONLY member is a `keys` array. Extra
/// top-level members are refused, not ignored, so an issuer cannot slip
/// verifier-affecting metadata past this parser.
pub fn parse_jwks(document: &Value) -> Result<Vec<Jwk>, VerificationError> {
    let document_invalid = || {
        VerificationError::new(
            ErrorCode::JwksDocumentInvalid,
            "JWKS response must be an object containing only a keys array",
        )
    };

    let object = document.as_object().ok_or_else(document_invalid)?;
    if object.len() != 1 {
        return Err(document_invalid());
    }
    let entries = object
        .get("keys")
        .and_then(Value::as_array)
        .ok_or_else(document_invalid)?;

    if entries.len() > MAX_JWKS_KEYS {
        return Err(VerificationError::new(
            ErrorCode::JwksTooManyKeys,
            "JWKS response exceeds the 64-key limit",
        ));
    }

    let mut keys: Vec<Jwk> = Vec::with_capacity(entries.len());
    for entry in entries {
        let key = parse_public_es256_jwk(entry)?;
        if keys.iter().any(|existing| existing.kid == key.kid) {
            return Err(VerificationError::new(
                ErrorCode::JwksDuplicateKid,
                "JWKS response contains duplicate kid values",
            ));
        }
        keys.push(key);
    }
    Ok(keys)
}

/// Parse a JWKS document from raw bytes.
pub fn parse_jwks_bytes(bytes: &[u8]) -> Result<Vec<Jwk>, VerificationError> {
    if bytes.len() > JWKS_MAX_BYTES {
        return Err(VerificationError::new(
            ErrorCode::JwksResponseTooLarge,
            "JWKS response exceeds the 64 KiB limit",
        ));
    }
    let document: Value = serde_json::from_slice(bytes).map_err(|_| {
        VerificationError::new(
            ErrorCode::JwksDocumentInvalid,
            "JWKS response is not valid JSON",
        )
    })?;
    parse_jwks(&document)
}

/// Resolves the verification key named by a token's `kid`.
pub trait KeySource {
    /// Return the key for `kid`, or the first published key when `kid` is `None`.
    fn resolve_key(&self, kid: Option<&str>) -> Result<Jwk, VerificationError>;
}

fn pick(keys: &[Jwk], kid: Option<&str>) -> Option<Jwk> {
    match kid {
        None | Some("") => keys.first().cloned(),
        Some(kid) => keys.iter().find(|key| key.kid == kid).cloned(),
    }
}

/// Serves a fixed key set. Use in tests, or when keys arrive out of band.
#[derive(Debug, Clone)]
pub struct StaticKeySource {
    keys: Vec<Jwk>,
}

impl StaticKeySource {
    pub fn from_document(document: &Value) -> Result<Self, VerificationError> {
        Ok(Self {
            keys: parse_jwks(document)?,
        })
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, VerificationError> {
        Ok(Self {
            keys: parse_jwks_bytes(bytes)?,
        })
    }
}

impl KeySource for StaticKeySource {
    fn resolve_key(&self, kid: Option<&str>) -> Result<Jwk, VerificationError> {
        pick(&self.keys, kid).ok_or_else(|| {
            VerificationError::new(
                ErrorCode::JwksKeyNotFound,
                "no matching JWKS key for the token kid",
            )
        })
    }
}
