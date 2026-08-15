//! Webhook signature verification.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::error::WebhookConfigError;

pub const DEFAULT_TOLERANCE_SECONDS: i64 = 300;
pub const MAX_TOLERANCE_SECONDS: i64 = 3600;
pub const MAX_BODY_BYTES: usize = 1024 * 1024;
pub const MAX_SIGNATURES: usize = 4;
pub const MAX_SECRETS: usize = 2;
pub const MAX_HEADER_LENGTH: usize = 1024;

/// One webhook delivery to verify.
#[derive(Debug, Clone)]
pub struct WebhookInput<'a> {
    /// The EXACT request bytes. Do not parse and re-serialize the JSON before
    /// verifying - re-serialization reorders keys and breaks the HMAC.
    pub raw_body: &'a [u8],
    pub timestamp: &'a str,
    pub signature_header: &'a str,
    /// The current and, during rotation overlap, the previous secret.
    pub secrets: &'a [String],
    /// The current time in Unix seconds.
    pub now: i64,
    /// Accepted clock skew, from 0 through 3600.
    ///
    /// `None` means the 300-second default; `Some(0)` demands an exact-second
    /// match. Keeping these distinct matters - collapsing them would silently
    /// turn the strictest setting into the loosest.
    pub tolerance_seconds: Option<i64>,
}

/// Verify an AuthOwl webhook HMAC before parsing or acting on its body.
///
/// Returns `Ok(false)` for anything wrong with the untrusted request, and
/// `Err(WebhookConfigError)` only for invalid local configuration, so a broken
/// endpoint fails loudly instead of silently dropping every delivery.
pub fn verify_webhook(input: &WebhookInput<'_>) -> Result<bool, WebhookConfigError> {
    validate_secrets(input.secrets)?;

    let tolerance = input.tolerance_seconds.unwrap_or(DEFAULT_TOLERANCE_SECONDS);
    if !(0..=MAX_TOLERANCE_SECONDS).contains(&tolerance) {
        return Err(WebhookConfigError);
    }

    if input.raw_body.len() > MAX_BODY_BYTES {
        return Ok(false);
    }
    let Some(timestamp) = parse_timestamp(input.timestamp) else {
        return Ok(false);
    };
    if (input.now - timestamp).abs() > tolerance {
        return Ok(false);
    }

    let supplied = parse_signatures(input.signature_header);
    if supplied.is_empty() {
        return Ok(false);
    }

    let mut signed = Vec::with_capacity(input.timestamp.len() + 1 + input.raw_body.len());
    signed.extend_from_slice(input.timestamp.as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(input.raw_body);

    let mut matched = false;
    for secret in input.secrets {
        let mut mac =
            <Hmac<Sha256>>::new_from_slice(secret.as_bytes()).map_err(|_| WebhookConfigError)?;
        mac.update(&signed);
        let expected = mac.finalize().into_bytes();
        let expected: &[u8] = &expected;
        for candidate in &supplied {
            // No early exit: comparing every candidate keeps the work
            // independent of where a match occurs.
            matched |= bool::from(expected.ct_eq(candidate.as_slice()));
        }
    }
    Ok(matched)
}

fn validate_secrets(secrets: &[String]) -> Result<(), WebhookConfigError> {
    if secrets.is_empty() || secrets.len() > MAX_SECRETS {
        return Err(WebhookConfigError);
    }
    for (index, secret) in secrets.iter().enumerate() {
        if !is_valid_secret(secret) || secrets[..index].contains(secret) {
            return Err(WebhookConfigError);
        }
    }
    Ok(())
}

fn is_valid_secret(secret: &str) -> bool {
    let Some(suffix) = secret.strip_prefix("whsec_") else {
        return false;
    };
    !suffix.is_empty()
        && suffix.len() <= 256
        && suffix
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Accepts `0` or a digit string with no leading zero, up to 11 digits - the
/// same grammar every other AuthOwl SDK applies.
fn parse_timestamp(value: &str) -> Option<i64> {
    if value.is_empty() || value.len() > 11 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if value.len() > 1 && value.starts_with('0') {
        return None;
    }
    value.parse::<i64>().ok()
}

fn parse_signatures(header: &str) -> Vec<Vec<u8>> {
    if header.len() > MAX_HEADER_LENGTH {
        return Vec::new();
    }
    let entries: Vec<&str> = header.split(',').collect();
    if entries.len() > MAX_SIGNATURES {
        return Vec::new();
    }
    entries
        .iter()
        .filter_map(|entry| {
            let entry = entry.trim();
            let hex = entry
                .strip_prefix("v1=")
                .or_else(|| entry.strip_prefix("V1="))?;
            if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            decode_hex(hex)
        })
        .collect()
}

fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).ok())
        .collect()
}
