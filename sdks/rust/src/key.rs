//! Publishable-key decoding.

use crate::error::KeyError;

/// The deployment a publishable key belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Live,
    Test,
}

impl Environment {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Test => "test",
        }
    }
}

/// The decoded form of a `pk_live_…` / `pk_test_…` key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishableKey {
    pub prefix: String,
    pub env: Environment,
    pub project_id: String,
}

/// Validate a publishable key and extract its project id.
///
/// Returns [`KeyError::SecretKeySupplied`] for anything starting `sk_`. That
/// check runs FIRST, before any shape validation: a secret key must never be
/// reported as merely "malformed", because the fix is to rotate it.
pub fn decode_publishable_key(key: &str) -> Result<PublishableKey, KeyError> {
    if key.is_empty() {
        return Err(KeyError::Required);
    }
    if key.len() >= 3 && key[..3].eq_ignore_ascii_case("sk_") {
        return Err(KeyError::SecretKeySupplied);
    }

    // Hand-rolled rather than a regex dependency: the grammar is fixed and this
    // keeps the crate's dependency surface to crypto only.
    let mut parts = key.splitn(4, '_');
    let pk = parts.next().ok_or(KeyError::Malformed)?;
    let env_part = parts.next().ok_or(KeyError::Malformed)?;
    let project_id = parts.next().ok_or(KeyError::Malformed)?;
    let suffix = parts.next().ok_or(KeyError::Malformed)?;

    if pk != "pk" {
        return Err(KeyError::Malformed);
    }
    let env = match env_part {
        "live" => Environment::Live,
        "test" => Environment::Test,
        _ => return Err(KeyError::Malformed),
    };
    if project_id.len() != 36
        || !project_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err(KeyError::Malformed);
    }
    if suffix.len() < 20 || !suffix.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(KeyError::Malformed);
    }

    Ok(PublishableKey {
        prefix: format!("pk_{}", env.as_str()),
        env,
        // Lowercased because the check above accepts any ASCII hex digit, so an
        // upper-case uuid is a VALID key. Returned verbatim it would never equal
        // the lowercase Postgres `uuid` the server puts in a JWT `aud` or names
        // its session cookie after.
        project_id: project_id.to_ascii_lowercase(),
    })
}
