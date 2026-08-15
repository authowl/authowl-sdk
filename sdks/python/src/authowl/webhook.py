"""Webhook signature verification."""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from typing import Callable, Sequence

from .errors import ConfigurationError

DEFAULT_TOLERANCE_SECONDS = 300
MAX_TOLERANCE_SECONDS = 3600
MAX_BODY_BYTES = 1024 * 1024
MAX_SIGNATURES = 4
MAX_SECRETS = 2
MAX_HEADER_LENGTH = 1024

_SIGNATURE = re.compile(r"^v1=([a-f0-9]{64})$", re.IGNORECASE)
_SECRET = re.compile(r"^whsec_[A-Za-z0-9_-]{1,256}$")
_TIMESTAMP = re.compile(r"^(0|[1-9]\d{0,10})$")


def verify_webhook(
    *,
    raw_body: bytes | str,
    timestamp: str,
    signature_header: str,
    secrets: Sequence[str],
    now: float | None = None,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    clock: Callable[[], float] = time.time,
) -> bool:
    """Verify an AuthOwl webhook HMAC before parsing or acting on its body.

    ``raw_body`` must be the EXACT request bytes. Do not parse and re-serialize
    the JSON first - re-serialization reorders keys and breaks the HMAC.

    Returns False for anything wrong with the untrusted request. Raises
    :class:`ConfigurationError` only for invalid LOCAL configuration, so a broken
    endpoint fails loudly instead of silently dropping every delivery.
    """
    _validate_secrets(secrets)

    if isinstance(tolerance_seconds, bool) or not isinstance(tolerance_seconds, int):
        raise ConfigurationError("tolerance_seconds must be an integer from 0 to 3600.")
    if not 0 <= tolerance_seconds <= MAX_TOLERANCE_SECONDS:
        raise ConfigurationError("tolerance_seconds must be an integer from 0 to 3600.")

    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else bytes(raw_body)
    if len(body) > MAX_BODY_BYTES:
        return False
    if not isinstance(timestamp, str) or not _TIMESTAMP.match(timestamp):
        return False

    current = int(clock() if now is None else now)
    if abs(current - int(timestamp)) > tolerance_seconds:
        return False

    supplied = _parse_signatures(signature_header)
    if not supplied:
        return False

    signed = f"{timestamp}.".encode("utf-8") + body
    matched = False
    for secret in secrets:
        expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).digest()
        for candidate in supplied:
            # No early exit: comparing every candidate keeps the work independent
            # of where a match occurs.
            if hmac.compare_digest(expected, candidate):
                matched = True
    return matched


def _validate_secrets(secrets: Sequence[str]) -> None:
    if (
        not isinstance(secrets, Sequence)
        or isinstance(secrets, (str, bytes))
        or not 1 <= len(secrets) <= MAX_SECRETS
        or any(not isinstance(secret, str) or not _SECRET.match(secret) for secret in secrets)
        or len(set(secrets)) != len(secrets)
    ):
        raise ConfigurationError(
            "Webhook secrets must contain one or two unique whsec_ values."
        )


def _parse_signatures(header: str) -> list[bytes]:
    if not isinstance(header, str) or len(header) > MAX_HEADER_LENGTH:
        return []
    entries = header.split(",")
    if len(entries) > MAX_SIGNATURES:
        return []
    signatures: list[bytes] = []
    for entry in entries:
        match = _SIGNATURE.match(entry.strip())
        if match is None:
            continue
        signatures.append(bytes.fromhex(match.group(1)))
    return signatures
