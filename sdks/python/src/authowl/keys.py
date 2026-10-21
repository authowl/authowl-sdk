"""Publishable-key decoding."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .errors import (
    MalformedPublishableKeyError,
    PublishableKeyRequiredError,
    SecretKeySuppliedError,
)

_PUBLISHABLE_KEY = re.compile(
    r"^(pk_(live|test))_(?:([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)_)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_([A-Za-z0-9]{20,})$"
)
_SECRET_KEY = re.compile(r"^sk_", re.IGNORECASE)


@dataclass(frozen=True)
class PublishableKey:
    """The decoded form of a ``pk_live_…`` / ``pk_test_…`` key."""

    prefix: str
    env: Literal["live", "test"]
    project_id: str
    region: str | None = None


def decode_publishable_key(key: str) -> PublishableKey:
    """Validate a publishable key and extract its project id.

    Raises :class:`SecretKeySuppliedError` for anything starting ``sk_``. That
    check runs FIRST, before any shape validation: a secret key must never be
    reported as merely "malformed", because the fix is to rotate it, not correct
    a typo.
    """
    if not key:
        raise PublishableKeyRequiredError("publishableKey is required")
    if _SECRET_KEY.match(key):
        raise SecretKeySuppliedError(
            "A secret key was passed where a publishable key was expected. "
            "Never embed secret keys in client code."
        )
    match = _PUBLISHABLE_KEY.fullmatch(key)
    if match is None or len(match.group(3) or "") > 24:
        raise MalformedPublishableKeyError(
            "publishableKey is malformed; expected pk_(live|test)_[<region>_]<uuid>_<base62>"
        )
    env = match.group(2).lower()
    return PublishableKey(
        prefix=match.group(1).lower(),
        env="live" if env == "live" else "test",
        # Lowercased for the same reason as prefix and env: the pattern accepts
        # ``[0-9a-fA-F-]``, so an upper-case uuid is a VALID key, and returning
        # it verbatim yields an id that never equals the lowercase Postgres
        # ``uuid`` the server puts in a JWT ``aud`` or names its cookie after.
        project_id=match.group(4).lower(),
        region=match.group(3).lower() if match.group(3) else None,
    )
