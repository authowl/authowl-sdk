"""Runs the language-neutral AuthOwl conformance corpus against this SDK.

These are the SAME vectors the TypeScript, Go, PHP, and Rust SDKs run. If
a case here fails, this implementation has diverged from the contract - fix the
code, not the vector. See conformance/README.md.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from authowl import (
    ConfigurationError,
    MalformedPublishableKeyError,
    Membership,
    PublishableKeyRequiredError,
    SecretKeySuppliedError,
    StaticKeySource,
    TokenVerificationError,
    Verifier,
    decode_publishable_key,
    parse_jwks,
    session_cookie_name,
    verify_webhook,
)

VECTORS = Path(__file__).resolve().parents[3] / "conformance" / "vectors"


def load(name: str) -> Any:
    return json.loads((VECTORS / name).read_text(encoding="utf-8"))


def ids(cases: list[dict[str, Any]]) -> list[str]:
    return [case["name"] for case in cases]


# ---------------------------------------------------------------------------

JWT = load("jwt-verify.json")


@pytest.mark.parametrize("case", JWT["cases"], ids=ids(JWT["cases"]))
def test_token_verification(case: dict[str, Any]) -> None:
    verifier = Verifier(
        issuer=JWT["issuer"],
        audience=JWT["audience"],
        keys=StaticKeySource(JWT["jwks"]),
        clock_tolerance_seconds=case.get("clockToleranceSeconds", 60),
        now=lambda: float(case["now"]),
    )
    expected = case["expect"]

    if not expected["ok"]:
        with pytest.raises(TokenVerificationError) as raised:
            verifier.verify(case["token"])
        assert raised.value.code.value == expected["code"]
        return

    verified = verifier.verify(case["token"])
    assert verified.subject == expected["sub"]

    if expected["membership"] is None:
        assert verified.membership is None
    else:
        assert verified.membership is not None
        assert verified.membership.role == expected["membership"]["role"]
        assert list(verified.membership.permissions) == expected["membership"]["permissions"]
        expected_teams = expected["membership"].get("teams")
        actual_teams = (
            None if verified.membership.teams is None else list(verified.membership.teams)
        )
        assert actual_teams == expected_teams


# ---------------------------------------------------------------------------

JWKS = load("jwks-parse.json")


@pytest.mark.parametrize("case", JWKS["cases"], ids=ids(JWKS["cases"]))
def test_jwks_parsing(case: dict[str, Any]) -> None:
    expected = case["expect"]
    if not expected["ok"]:
        with pytest.raises(TokenVerificationError) as raised:
            parse_jwks(case["document"])
        assert raised.value.code.value == expected["code"]
        return
    assert len(parse_jwks(case["document"])) == expected["keys"]


# ---------------------------------------------------------------------------

COOKIE = load("cookie-name.json")


@pytest.mark.parametrize("case", COOKIE["cases"], ids=ids(COOKIE["cases"]))
def test_session_cookie_name(case: dict[str, Any]) -> None:
    assert (
        session_cookie_name(case["projectId"], secure=case.get("secure", False))
        == case["expect"]
    )


# ---------------------------------------------------------------------------

KEYS = load("publishable-key.json")


@pytest.mark.parametrize("case", KEYS["cases"], ids=ids(KEYS["cases"]))
def test_publishable_key(case: dict[str, Any]) -> None:
    expected = case["expect"]
    if expected["ok"]:
        decoded = decode_publishable_key(case["key"])
        assert decoded.prefix == expected["prefix"]
        assert decoded.env == expected["env"]
        assert decoded.project_id == expected["projectId"]
        return

    # Collapse the raised type to the portable reason every SDK reports.
    reasons = {
        PublishableKeyRequiredError: "missing",
        SecretKeySuppliedError: "secret_key",
        MalformedPublishableKeyError: "malformed",
    }
    with pytest.raises(tuple(reasons)) as raised:
        decode_publishable_key(case["key"])
    assert reasons[type(raised.value)] == expected["reason"]


# ---------------------------------------------------------------------------

MEMBERSHIP = load("membership-has.json")


def to_membership(raw: Any) -> Membership | None:
    if raw is None:
        return None
    teams = raw.get("teams")
    return Membership(
        role=raw.get("role", ""),
        permissions=tuple(raw.get("permissions", ())),
        teams=None if teams is None else tuple(teams),
    )


@pytest.mark.parametrize("case", MEMBERSHIP["hasCases"], ids=ids(MEMBERSHIP["hasCases"]))
def test_membership_has(case: dict[str, Any]) -> None:
    membership = to_membership(case["membership"])
    params = case["params"]
    actual = membership is not None and membership.has(
        role=params.get("role"),
        permission=params.get("permission"),
        team_id=params.get("teamId"),
    )
    assert actual == case["expect"]


@pytest.mark.parametrize(
    "case", MEMBERSHIP["hasPermissionCases"], ids=ids(MEMBERSHIP["hasPermissionCases"])
)
def test_membership_has_permission(case: dict[str, Any]) -> None:
    membership = to_membership(case["membership"])
    actual = membership is not None and membership.has_permission(case["permission"])
    assert actual == case["expect"]


# ---------------------------------------------------------------------------

WEBHOOK = load("webhook-verify.json")


@pytest.mark.parametrize("case", WEBHOOK["cases"], ids=ids(WEBHOOK["cases"]))
def test_webhook_verification(case: dict[str, Any]) -> None:
    call = lambda: verify_webhook(  # noqa: E731
        raw_body=case["rawBody"],
        timestamp=case["timestamp"],
        signature_header=case["signatureHeader"],
        secrets=case["secrets"],
        now=case["now"],
        tolerance_seconds=case.get("toleranceSeconds", 300),
    )
    if case["expect"].get("throws"):
        # Local misconfiguration is LOUD; only untrusted input degrades to False.
        with pytest.raises(ConfigurationError):
            call()
        return
    assert call() is case["expect"]["result"]
