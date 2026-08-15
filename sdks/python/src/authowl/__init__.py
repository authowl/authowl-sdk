"""AuthOwl Python SDK - server-side verification and authorization.

This package is the RELYING-PARTY side of AuthOwl. It never signs anyone in:
the browser or mobile app authenticates against the AuthOwl server directly, and
this SDK validates what arrives and calls the Admin API.

    from authowl import Verifier, RemoteKeySource, session_cookie_name

    verifier = Verifier(
        issuer="https://api.authowl.dev/api/projects/<id>/auth",
        audience="<project-id>",
        keys=RemoteKeySource("https://api.authowl.dev/api/projects/<id>/auth/jwks"),
    )

    if verifier.has(token, permission="org:billing:read"):
        ...
"""

from .cookie import session_cookie_name
from .errors import (
    AuthOwlError,
    ConfigurationError,
    ErrorCode,
    MalformedPublishableKeyError,
    PublishableKeyRequiredError,
    SecretKeySuppliedError,
    TokenVerificationError,
)
from .jwks import JWK, KeySource, RemoteKeySource, StaticKeySource, parse_jwks
from .keys import PublishableKey, decode_publishable_key
from .membership import Membership, membership_has, membership_has_permission
from .verify import (
    DEFAULT_CLOCK_TOLERANCE_SECONDS,
    MAX_CLOCK_TOLERANCE_SECONDS,
    VerifiedToken,
    Verifier,
)
from .webhook import verify_webhook

__version__ = "0.1.0"

__all__ = [
    "JWK",
    "DEFAULT_CLOCK_TOLERANCE_SECONDS",
    "MAX_CLOCK_TOLERANCE_SECONDS",
    "AuthOwlError",
    "ConfigurationError",
    "ErrorCode",
    "KeySource",
    "MalformedPublishableKeyError",
    "Membership",
    "PublishableKey",
    "PublishableKeyRequiredError",
    "RemoteKeySource",
    "SecretKeySuppliedError",
    "StaticKeySource",
    "TokenVerificationError",
    "VerifiedToken",
    "Verifier",
    "decode_publishable_key",
    "membership_has",
    "membership_has_permission",
    "parse_jwks",
    "session_cookie_name",
    "verify_webhook",
]
