"""JWKS document parsing and key sources."""

from __future__ import annotations

import base64
import json
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Protocol, Sequence

from cryptography.hazmat.primitives.asymmetric import ec

from .errors import ErrorCode, TokenVerificationError

MAX_JWKS_KEYS = 64
#: Bound the JWKS response so a hostile or misconfigured issuer cannot exhaust
#: memory. Matches the TypeScript SDK's ceiling.
JWKS_MAX_BYTES = 64 * 1024
JWKS_CACHE_TTL_SECONDS = 5 * 60
JWKS_FETCH_TIMEOUT_SECONDS = 5.0
JWKS_FORCE_REFETCH_COOLDOWN_SECONDS = 60

_KID = re.compile(r"^[A-Za-z0-9_-]+$")
_COORDINATE = re.compile(r"^[A-Za-z0-9_-]{43}$")

_ALLOWED_MEMBERS = {"alg", "crv", "kid", "kty", "use", "x", "y"}
#: ``d`` is the private scalar; the RSA/oct members are listed so a key from the
#: wrong family is refused loudly rather than silently ignored.
_PRIVATE_MEMBERS = ("d", "p", "q", "dp", "dq", "qi", "k", "oth")


@dataclass(frozen=True)
class JWK:
    """A published ES256 verification key."""

    kid: str
    x: str
    y: str
    public_key: ec.EllipticCurvePublicKey


def _decode_coordinate(value: Any) -> int | None:
    if not isinstance(value, str) or not _COORDINATE.match(value):
        return None
    raw = base64.urlsafe_b64decode(value + "=")
    if len(raw) != 32:
        return None
    return int.from_bytes(raw, "big")


def _parse_public_es256_jwk(raw: Any) -> JWK:
    """Enforce the AuthOwl public-key schema.

    Anything outside it - a private member, an unexpected member, the wrong curve
    - is refused rather than tolerated, so a compromised or confused JWKS cannot
    smuggle in a key this verifier would trust.
    """
    invalid = TokenVerificationError(
        "JWKS contains a key outside the AuthOwl ES256 public-key schema",
        ErrorCode.JWKS_KEY_INVALID,
    )
    if not isinstance(raw, Mapping):
        raise TokenVerificationError(
            "JWKS contains a non-object key", ErrorCode.JWKS_KEY_INVALID
        )
    if "key_ops" in raw or any(member in raw for member in _PRIVATE_MEMBERS):
        raise TokenVerificationError(
            "JWKS key carries private key material or key_ops", ErrorCode.JWKS_KEY_INVALID
        )
    if any(member not in _ALLOWED_MEMBERS for member in raw):
        raise TokenVerificationError(
            "JWKS key carries an unexpected member", ErrorCode.JWKS_KEY_INVALID
        )

    if (
        raw.get("kty") != "EC"
        or raw.get("crv") != "P-256"
        or raw.get("alg") != "ES256"
        or raw.get("use") != "sig"
    ):
        raise invalid

    kid = raw.get("kid")
    if not isinstance(kid, str) or not 0 < len(kid) <= 128 or not _KID.match(kid):
        raise invalid

    x = _decode_coordinate(raw.get("x"))
    y = _decode_coordinate(raw.get("y"))
    if x is None or y is None:
        raise invalid

    try:
        # Raises when the point is not on the curve, which is exactly the check
        # an off-curve key attack needs to trip.
        public_key = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()
    except ValueError as error:
        raise invalid from error

    return JWK(kid=kid, x=str(raw["x"]), y=str(raw["y"]), public_key=public_key)


def parse_jwks(document: Any) -> list[JWK]:
    """Validate a JWKS document and return its verification keys.

    The document must be an object whose ONLY member is a ``keys`` array. Extra
    top-level members are refused, not ignored, so an issuer cannot slip
    verifier-affecting metadata past this parser.
    """
    if isinstance(document, (str, bytes, bytearray)):
        try:
            document = json.loads(document)
        except (ValueError, TypeError) as error:
            raise TokenVerificationError(
                "JWKS response is not valid JSON", ErrorCode.JWKS_DOCUMENT_INVALID
            ) from error

    if (
        not isinstance(document, Mapping)
        or len(document) != 1
        or not isinstance(document.get("keys"), Sequence)
        or isinstance(document.get("keys"), (str, bytes))
    ):
        raise TokenVerificationError(
            "JWKS response must be an object containing only a keys array",
            ErrorCode.JWKS_DOCUMENT_INVALID,
        )

    entries = document["keys"]
    if len(entries) > MAX_JWKS_KEYS:
        raise TokenVerificationError(
            "JWKS response exceeds the 64-key limit", ErrorCode.JWKS_TOO_MANY_KEYS
        )

    keys: list[JWK] = []
    seen: set[str] = set()
    for entry in entries:
        key = _parse_public_es256_jwk(entry)
        if key.kid in seen:
            raise TokenVerificationError(
                "JWKS response contains duplicate kid values", ErrorCode.JWKS_DUPLICATE_KID
            )
        seen.add(key.kid)
        keys.append(key)
    return keys


def _pick(keys: Iterable[JWK], kid: str | None) -> JWK | None:
    keys = list(keys)
    if not kid:
        return keys[0] if keys else None
    return next((key for key in keys if key.kid == kid), None)


class KeySource(Protocol):
    """Resolves the verification key named by a token's ``kid``."""

    def resolve_key(self, kid: str | None) -> JWK:
        """Return the key for ``kid``, or the first published key when kid is empty.

        Raises :class:`TokenVerificationError` with ``JWKS_KEY_NOT_FOUND`` when no
        key matches.
        """
        ...


class StaticKeySource:
    """Serves a fixed key set. Use in tests, or when keys arrive out of band."""

    def __init__(self, document: Any) -> None:
        self._keys = parse_jwks(document)

    def resolve_key(self, kid: str | None) -> JWK:
        key = _pick(self._keys, kid)
        if key is None:
            raise TokenVerificationError(
                "No matching JWKS key for the token kid", ErrorCode.JWKS_KEY_NOT_FOUND
            )
        return key


class RemoteKeySource:
    """Fetches and caches a project's published JWKS.

    An unknown ``kid`` may be a freshly rotated key, so this forces ONE
    cache-bypassing refetch to try to pick it up. That forced refetch is
    rate-limited: a flood of bogus-kid tokens must not become a flood of outbound
    requests, which would be a cheap amplification lever against the issuer.
    Legitimate rotation is unaffected - the server keeps signing with the old kid
    long enough for the normal TTL refresh to carry the new one.
    """

    def __init__(self, uri: str, *, now: Any = time.time) -> None:
        self.uri = uri
        self._now = now
        self._lock = threading.Lock()
        self._keys: list[JWK] | None = None
        self._fetched_at = 0.0
        self._last_forced_at = float("-inf")

    def resolve_key(self, kid: str | None) -> JWK:
        key = _pick(self._load(force=False), kid)
        if key is not None:
            return key

        with self._lock:
            now = self._now()
            may_force = now - self._last_forced_at >= JWKS_FORCE_REFETCH_COOLDOWN_SECONDS
            if may_force:
                self._last_forced_at = now

        if may_force:
            key = _pick(self._load(force=True), kid)
            if key is not None:
                return key

        raise TokenVerificationError(
            "No matching JWKS key for the token kid", ErrorCode.JWKS_KEY_NOT_FOUND
        )

    def _load(self, *, force: bool) -> list[JWK]:
        with self._lock:
            cached = self._keys
            fresh = (
                cached is not None
                and self._now() - self._fetched_at < JWKS_CACHE_TTL_SECONDS
            )
        if not force and fresh and cached is not None:
            return cached

        request = urllib.request.Request(  # noqa: S310 - the URL is operator-configured
            self.uri, headers={"accept": "application/json"}
        )
        try:
            with urllib.request.urlopen(  # noqa: S310
                request, timeout=JWKS_FETCH_TIMEOUT_SECONDS
            ) as response:
                if not 200 <= response.status <= 299:
                    raise TokenVerificationError(
                        "JWKS fetch returned a non-success status", ErrorCode.JWKS_HTTP_ERROR
                    )
                # Read one byte past the ceiling so an oversized body is detected
                # rather than silently truncated into something that still parses.
                body = response.read(JWKS_MAX_BYTES + 1)
        except urllib.error.HTTPError as error:
            raise TokenVerificationError(
                "JWKS fetch returned a non-success status", ErrorCode.JWKS_HTTP_ERROR
            ) from error
        except TimeoutError as error:
            raise TokenVerificationError(
                "JWKS fetch timed out", ErrorCode.JWKS_FETCH_TIMEOUT
            ) from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, TimeoutError):
                raise TokenVerificationError(
                    "JWKS fetch timed out", ErrorCode.JWKS_FETCH_TIMEOUT
                ) from error
            raise TokenVerificationError(
                "Failed to fetch JWKS", ErrorCode.JWKS_FETCH_FAILED
            ) from error

        if len(body) > JWKS_MAX_BYTES:
            raise TokenVerificationError(
                "JWKS response exceeds the 64 KiB limit", ErrorCode.JWKS_RESPONSE_TOO_LARGE
            )

        keys = parse_jwks(body)
        with self._lock:
            self._keys = keys
            self._fetched_at = self._now()
        return keys
