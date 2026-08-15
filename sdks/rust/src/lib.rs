//! Server-side SDK for [AuthOwl](https://authowl.dev), the multi-tenant auth SaaS.
//!
//! This crate is the RELYING-PARTY side of AuthOwl. It never signs anyone in:
//! your frontend authenticates against the AuthOwl server directly, and this
//! crate validates what arrives at your backend.
//!
//! ```no_run
//! use authowl::{Query, StaticKeySource, Verifier};
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let project_id = "2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60";
//! let issuer = format!("https://api.authowl.dev/api/projects/{project_id}/auth");
//! let keys = StaticKeySource::from_bytes(br#"{"keys":[]}"#)?;
//! let verifier = Verifier::new(issuer, project_id, keys)?;
//!
//! // `has` fails CLOSED: an invalid or expired token denies rather than erroring.
//! if verifier.has(" some.jwt.here", &Query::permission("org:billing:read")) {
//!     // ...
//! }
//! # Ok(())
//! # }
//! ```
//!
//! Every AuthOwl SDK runs one shared corpus of conformance vectors covering JWT
//! verification, JWKS hardening, cookie naming, key decoding, membership
//! evaluation, and webhook signatures. See `conformance/README.md` at the repo
//! root.

#![forbid(unsafe_code)]
#![warn(missing_debug_implementations)]

pub mod cookie;
pub mod error;
pub mod jwks;
pub mod key;
pub mod membership;
pub mod verify;
pub mod webhook;

pub use cookie::session_cookie_name;
pub use error::{ErrorCode, KeyError, VerificationError, WebhookConfigError};
pub use jwks::{
    parse_jwks, parse_jwks_bytes, Jwk, KeySource, StaticKeySource, JWKS_MAX_BYTES, MAX_JWKS_KEYS,
};
pub use key::{decode_publishable_key, Environment, PublishableKey};
pub use membership::{membership_has, membership_has_permission, Membership, Query};
pub use verify::{
    VerifiedToken, Verifier, DEFAULT_CLOCK_TOLERANCE_SECONDS, MAX_CLOCK_TOLERANCE_SECONDS,
};
pub use webhook::{verify_webhook, WebhookInput};
