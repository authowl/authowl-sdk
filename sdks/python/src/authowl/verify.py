"""Stateless verification of AuthOwl project JWTs.

This is the REAL server-side authorization primitive. It verifies the ES256
signature against the project's published JWKS and checks issuer, audience, and
expiry BEFORE reading any claim, so no permission is ever granted off an
unverified claim.
"""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from .errors import ErrorCode, TokenVerificationError
from .jwks import KeySource
from .membership import Membership

DEFAULT_CLOCK_TOLERANCE_SECONDS = 60
#: A tolerance beyond this keeps revoked tokens alive too long to be called
#: authorization, so it is refused as a configuration error.
MAX_CLOCK_TOLERANCE_SECONDS = 300

_SEGMENT = re.compile(r"^[A-Za-z0-9_-]+$")
_SIGNATURE = re.compile(r"^[A-Za-z0-9_-]{86}$")


@dataclass(frozen=True)
class VerifiedToken:
    """The result of a successful verification."""

    #: The signed-in user id, or None when the token carries no ``sub``.
    subject: str | None
    #: The active-org membership, or None when the token carries none.
    membership: Membership | None
    #: The full verified claim set, for callers reading additional claims.
    claims: Mapping[str, Any] = field(default_factory=dict)


def _decode_segment(segment: str) -> dict[str, Any]:
    malformed = TokenVerificationError("Malformed JWT segment.", ErrorCode.TOKEN_MALFORMED)
    if not _SEGMENT.match(segment):
        raise malformed
    padding = "=" * (-len(segment) % 4)
    try:
        raw = base64.urlsafe_b64decode(segment + padding)
        parsed = json.loads(raw)
    except (ValueError, TypeError) as error:
        raise malformed from error
    if not isinstance(parsed, dict):
        raise malformed
    return parsed


def _as_number(value: Any) -> float | None:
    """Read a numeric claim.

    ``bool`` is excluded explicitly: Python makes ``isinstance(True, int)`` true,
    so without this a token carrying ``"exp": true`` would sail through as the
    number 1 and be treated as long expired - or, worse, as valid.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _audience_matches(aud: Any, expected: str) -> bool:
    if isinstance(aud, str):
        return aud == expected
    if isinstance(aud, list):
        return any(entry == expected for entry in aud if isinstance(entry, str))
    return False


class Verifier:
    """Verifies AuthOwl project JWTs against a project's published keys."""

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        keys: KeySource,
        clock_tolerance_seconds: int = DEFAULT_CLOCK_TOLERANCE_SECONDS,
        now: Callable[[], float] = time.time,
    ) -> None:
        if not issuer or not audience or keys is None:
            raise TokenVerificationError(
                "Verifier requires issuer, audience, and keys.", ErrorCode.TOKEN_CONFIG_INVALID
            )
        if (
            isinstance(clock_tolerance_seconds, bool)
            or not isinstance(clock_tolerance_seconds, int)
            or not 0 <= clock_tolerance_seconds <= MAX_CLOCK_TOLERANCE_SECONDS
        ):
            raise TokenVerificationError(
                "clock_tolerance_seconds must be an integer from 0 through 300.",
                ErrorCode.TOKEN_CONFIG_INVALID,
            )
        self.issuer = issuer
        self.audience = audience
        self.keys = keys
        self.clock_tolerance_seconds = clock_tolerance_seconds
        self._now = now

    def verify(self, token: str) -> VerifiedToken:
        """Verify a project JWT and return its subject, membership, and claims.

        Checks run in a deliberate order - structure, algorithm, key, signature,
        then claims - so a token with a bad signature always reports as a
        signature failure even when its claims are also invalid.
        """
        if not isinstance(token, str) or not token:
            raise TokenVerificationError(
                "A token string is required.", ErrorCode.TOKEN_MALFORMED
            )
        parts = token.split(".")
        if len(parts) != 3:
            raise TokenVerificationError("Malformed JWT.", ErrorCode.TOKEN_MALFORMED)
        header_segment, payload_segment, signature_segment = parts

        header = _decode_segment(header_segment)
        # The algorithm is pinned BEFORE key resolution, which is what defeats
        # the `alg: none` and HS256-confusion families outright.
        if header.get("alg") != "ES256":
            raise TokenVerificationError(
                "Unsupported JWT algorithm.", ErrorCode.TOKEN_ALGORITHM_UNSUPPORTED
            )
        kid = header.get("kid")
        key = self.keys.resolve_key(kid if isinstance(kid, str) else None)

        if not _SIGNATURE.match(signature_segment):
            raise TokenVerificationError(
                "Malformed JWT signature.", ErrorCode.TOKEN_MALFORMED
            )
        signature = base64.urlsafe_b64decode(signature_segment + "==")
        if len(signature) != 64:
            raise TokenVerificationError(
                "Malformed JWT signature.", ErrorCode.TOKEN_MALFORMED
            )

        der = encode_dss_signature(
            int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")
        )
        try:
            key.public_key.verify(
                der,
                f"{header_segment}.{payload_segment}".encode("ascii"),
                ec.ECDSA(hashes.SHA256()),
            )
        except InvalidSignature as error:
            raise TokenVerificationError(
                "Invalid token signature.", ErrorCode.TOKEN_SIGNATURE_INVALID
            ) from error

        claims = _decode_segment(payload_segment)
        now = int(self._now())
        tolerance = self.clock_tolerance_seconds

        # `exp` is REQUIRED, not skip-if-absent: a token with no expiry would
        # never fail closed on its own.
        exp = _as_number(claims.get("exp"))
        if exp is None:
            raise TokenVerificationError(
                "Token is missing a valid exp claim.", ErrorCode.TOKEN_CLAIM_INVALID
            )
        if exp + tolerance < now:
            raise TokenVerificationError(
                "Token has expired.", ErrorCode.TOKEN_CLAIM_INVALID
            )
        nbf = _as_number(claims.get("nbf"))
        if nbf is not None and nbf - tolerance > now:
            raise TokenVerificationError(
                "Token is not yet valid.", ErrorCode.TOKEN_CLAIM_INVALID
            )
        # `iss` is REQUIRED and must match exactly - including any trailing slash.
        if claims.get("iss") != self.issuer:
            raise TokenVerificationError(
                "Token issuer missing or mismatched.", ErrorCode.TOKEN_CLAIM_INVALID
            )
        if not _audience_matches(claims.get("aud"), self.audience):
            raise TokenVerificationError(
                "Token audience mismatch.", ErrorCode.TOKEN_CLAIM_INVALID
            )

        subject = claims.get("sub")
        return VerifiedToken(
            subject=subject if isinstance(subject, str) else None,
            membership=Membership.from_claim(claims.get("membership")),
            claims=claims,
        )

    def has(
        self,
        token: str,
        *,
        role: str | None = None,
        permission: str | None = None,
        team_id: str | None = None,
    ) -> bool:
        """Verify the token, then evaluate the query against its membership.

        Fails CLOSED: an invalid, tampered, expired, or wrong-audience token
        returns False rather than raising, so a caller that forgets to handle
        errors still denies. Configuration mistakes still raise - a misconfigured
        backend silently denying everything is far worse to debug.
        """
        try:
            verified = self.verify(token)
        except TokenVerificationError as error:
            if error.code is ErrorCode.TOKEN_CONFIG_INVALID:
                raise
            return False
        if verified.membership is None:
            return False
        return verified.membership.has(role=role, permission=permission, team_id=team_id)

    def has_permission(self, token: str, permission: str) -> bool:
        """Verify the token and report whether it grants ``permission``. Fails closed."""
        return self.has(token, permission=permission)
