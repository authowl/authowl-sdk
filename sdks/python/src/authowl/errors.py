"""Error types shared across the AuthOwl Python SDK."""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    """Why a token was refused.

    These codes are shared VERBATIM with every other AuthOwl SDK (see
    ``conformance/vectors/jwt-verify.json``), so a log line from Python means the
    same thing as one from Go or TypeScript. Match on the code, never the message.
    """

    TOKEN_VERIFICATION_FAILED = "TOKEN_VERIFICATION_FAILED"
    TOKEN_CONFIG_INVALID = "TOKEN_CONFIG_INVALID"
    TOKEN_MALFORMED = "TOKEN_MALFORMED"
    TOKEN_ALGORITHM_UNSUPPORTED = "TOKEN_ALGORITHM_UNSUPPORTED"
    TOKEN_SIGNATURE_INVALID = "TOKEN_SIGNATURE_INVALID"
    TOKEN_CLAIM_INVALID = "TOKEN_CLAIM_INVALID"
    JWKS_FETCH_FAILED = "JWKS_FETCH_FAILED"
    JWKS_FETCH_TIMEOUT = "JWKS_FETCH_TIMEOUT"
    JWKS_HTTP_ERROR = "JWKS_HTTP_ERROR"
    JWKS_RESPONSE_TOO_LARGE = "JWKS_RESPONSE_TOO_LARGE"
    JWKS_DOCUMENT_INVALID = "JWKS_DOCUMENT_INVALID"
    JWKS_TOO_MANY_KEYS = "JWKS_TOO_MANY_KEYS"
    JWKS_KEY_INVALID = "JWKS_KEY_INVALID"
    JWKS_DUPLICATE_KID = "JWKS_DUPLICATE_KID"
    JWKS_KEY_NOT_FOUND = "JWKS_KEY_NOT_FOUND"


class AuthOwlError(Exception):
    """Base class for every error this SDK raises."""


class TokenVerificationError(AuthOwlError):
    """A project JWT (or the JWKS backing it) was refused."""

    def __init__(self, message: str, code: ErrorCode = ErrorCode.TOKEN_VERIFICATION_FAILED) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:
        return f"{self.message} ({self.code.value})"


class ConfigurationError(AuthOwlError):
    """Local configuration is wrong.

    Raised rather than returned as a denial: a misconfigured backend that
    silently rejects every request is far harder to debug than one that fails
    loudly at the point of the mistake.
    """


class SecretKeySuppliedError(AuthOwlError):
    """A ``sk_`` key reached a function that expects a publishable key.

    A hard rule across every AuthOwl SDK. A leaked secret key compromises the
    whole project, so it is refused BEFORE any shape validation rather than
    quietly treated as malformed.
    """


class PublishableKeyRequiredError(AuthOwlError):
    """An empty publishable key was supplied."""


class MalformedPublishableKeyError(AuthOwlError):
    """A publishable key did not match ``pk_(live|test)_<uuid>_<base62>``."""
