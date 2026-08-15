//! Runs the language-neutral AuthOwl conformance corpus against this crate.
//!
//! These are the SAME vectors the TypeScript, Go, Python, and PHP SDKs
//! run. If a case here fails, this implementation has diverged from the contract
//! - fix the code, not the vector. See conformance/README.md.

use std::fs;
use std::path::PathBuf;

use authowl::{
    decode_publishable_key, parse_jwks, session_cookie_name, verify_webhook, KeyError, Membership,
    Query, StaticKeySource, Verifier, WebhookInput,
};
use serde_json::Value;

fn load(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance/vectors")
        .join(name);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    serde_json::from_str(&raw).expect("parse vectors")
}

fn cases(document: &Value, property: &str) -> Vec<Value> {
    document[property].as_array().expect("case array").clone()
}

fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_owned()
}

#[test]
fn token_verification() {
    let vectors = load("jwt-verify.json");
    let issuer = text(&vectors, "issuer");
    let audience = text(&vectors, "audience");

    let mut checked = 0;
    for case in cases(&vectors, "cases") {
        let name = text(&case, "name");
        let keys =
            StaticKeySource::from_document(&vectors["jwks"]).expect("parse conformance JWKS");
        let tolerance = case["clockToleranceSeconds"].as_u64().unwrap_or(60);
        let verifier = Verifier::with_clock_tolerance(&issuer, &audience, keys, tolerance)
            .unwrap_or_else(|error| panic!("{name}: build verifier: {error}"));

        let now = case["now"].as_i64().expect("now");
        let result = verifier.verify_at(case["token"].as_str().unwrap_or_default(), now);
        let expected = &case["expect"];

        if expected["ok"].as_bool() == Some(true) {
            let verified =
                result.unwrap_or_else(|error| panic!("{name}: expected success, got {error}"));

            let expected_subject = expected["sub"].as_str().map(str::to_owned);
            assert_eq!(verified.subject, expected_subject, "{name}: subject");

            let actual = serde_json::to_value(&verified.membership).expect("serialize membership");
            assert_eq!(actual, expected["membership"], "{name}: membership");
        } else {
            let error = result
                .err()
                .unwrap_or_else(|| panic!("{name}: expected a failure"));
            assert_eq!(error.code.as_str(), text(expected, "code"), "{name}: code");
        }
        checked += 1;
    }
    assert_eq!(checked, 38, "unexpected token vector count");
}

#[test]
fn jwks_parsing() {
    let vectors = load("jwks-parse.json");
    for case in cases(&vectors, "cases") {
        let name = text(&case, "name");
        let expected = &case["expect"];
        let result = parse_jwks(&case["document"]);

        if expected["ok"].as_bool() == Some(true) {
            let keys =
                result.unwrap_or_else(|error| panic!("{name}: expected success, got {error}"));
            assert_eq!(
                keys.len() as u64,
                expected["keys"].as_u64().unwrap(),
                "{name}: key count"
            );
        } else {
            let error = result
                .err()
                .unwrap_or_else(|| panic!("{name}: expected a failure"));
            assert_eq!(error.code.as_str(), text(expected, "code"), "{name}: code");
        }
    }
}

#[test]
fn session_cookie_names() {
    let vectors = load("cookie-name.json");
    for case in cases(&vectors, "cases") {
        let name = text(&case, "name");
        let secure = case["secure"].as_bool().unwrap_or(false);
        assert_eq!(
            session_cookie_name(&text(&case, "projectId"), secure),
            text(&case, "expect"),
            "{name}"
        );
    }
}

#[test]
fn publishable_keys() {
    let vectors = load("publishable-key.json");
    for case in cases(&vectors, "cases") {
        let name = text(&case, "name");
        let expected = &case["expect"];
        let result = decode_publishable_key(&text(&case, "key"));

        if expected["ok"].as_bool() == Some(true) {
            let decoded =
                result.unwrap_or_else(|error| panic!("{name}: expected success, got {error}"));
            assert_eq!(decoded.prefix, text(expected, "prefix"), "{name}: prefix");
            assert_eq!(decoded.env.as_str(), text(expected, "env"), "{name}: env");
            assert_eq!(
                decoded.project_id,
                text(expected, "projectId"),
                "{name}: project id"
            );
        } else {
            // Collapse the error to the portable reason every SDK reports.
            let reason = match result.expect_err("expected a failure") {
                KeyError::Required => "missing",
                KeyError::SecretKeySupplied => "secret_key",
                KeyError::Malformed => "malformed",
            };
            assert_eq!(reason, text(expected, "reason"), "{name}: reason");
        }
    }
}

fn to_membership(raw: &Value) -> Option<Membership> {
    if raw.is_null() {
        return None;
    }
    Some(serde_json::from_value(raw.clone()).expect("parse membership"))
}

#[test]
fn membership_evaluation() {
    let vectors = load("membership-has.json");

    for case in cases(&vectors, "hasCases") {
        let name = text(&case, "name");
        let membership = to_membership(&case["membership"]);
        let params = &case["params"];
        let query = Query {
            role: params["role"].as_str(),
            permission: params["permission"].as_str(),
            team_id: params["teamId"].as_str(),
        };
        let actual = membership.as_ref().is_some_and(|m| m.has(&query));
        assert_eq!(actual, case["expect"].as_bool().unwrap(), "has: {name}");
    }

    for case in cases(&vectors, "hasPermissionCases") {
        let name = text(&case, "name");
        let membership = to_membership(&case["membership"]);
        let permission = text(&case, "permission");
        let actual = membership
            .as_ref()
            .is_some_and(|m| m.has_permission(&permission));
        assert_eq!(
            actual,
            case["expect"].as_bool().unwrap(),
            "hasPermission: {name}"
        );
    }
}

#[test]
fn webhook_verification() {
    let vectors = load("webhook-verify.json");
    for case in cases(&vectors, "cases") {
        let name = text(&case, "name");
        let secrets: Vec<String> = case["secrets"]
            .as_array()
            .expect("secrets")
            .iter()
            .map(|entry| entry.as_str().unwrap_or_default().to_owned())
            .collect();
        let body = text(&case, "rawBody");
        let timestamp = text(&case, "timestamp");
        let signature_header = text(&case, "signatureHeader");

        let input = WebhookInput {
            raw_body: body.as_bytes(),
            timestamp: &timestamp,
            signature_header: &signature_header,
            secrets: &secrets,
            now: case["now"].as_i64().expect("now"),
            tolerance_seconds: case["toleranceSeconds"].as_i64(),
        };
        let result = verify_webhook(&input);
        let expected = &case["expect"];

        if expected["throws"].as_bool() == Some(true) {
            // Local misconfiguration is LOUD; only untrusted input degrades to false.
            assert!(result.is_err(), "{name}: expected a configuration error");
        } else {
            let ok = result.unwrap_or_else(|error| panic!("{name}: unexpected error {error}"));
            assert_eq!(ok, expected["result"].as_bool().unwrap(), "{name}");
        }
    }
}
