"""Pure evaluators for an organization membership claim.

No I/O: every decision here is made against the claim already carried by a
verified token, so the client and server paths can never disagree about what a
membership grants.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class Membership:
    """The active-organization membership carried by a verified token."""

    #: The member's canonical role key (owner/admin/member, or a project role).
    role: str = ""
    #: Effective permission ids: ``org:sys_*`` system claims plus the operator's
    #: custom ``org:<feature>:<action>`` ids.
    permissions: tuple[str, ...] = field(default_factory=tuple)
    #: Team ids held inside the ACTIVE organization.
    #:
    #: ``None`` (not an empty tuple) when the token carries no ``teams`` claim at
    #: all, which is what a token minted before teams shipped looks like. An
    #: absent claim is never read as "any team".
    teams: tuple[str, ...] | None = None

    def has_permission(self, permission: str) -> bool:
        """Whether the permission claim includes ``permission``. Exact match only."""
        if not permission:
            return False
        return permission in self.permissions

    def has_team(self, team_id: str) -> bool:
        """Whether the team claim includes ``team_id``.

        Teams are pure grouping: belonging to one grants nothing on its own, so
        this is for the application's own gating, never an authority check.
        """
        if not team_id or self.teams is None:
            return False
        return team_id in self.teams

    def has(
        self,
        *,
        role: str | None = None,
        permission: str | None = None,
        team_id: str | None = None,
    ) -> bool:
        """Whether the membership satisfies EVERY supplied criterion (AND).

        Asking nothing grants nothing: a query with no criteria returns False.
        """
        if role is None and permission is None and team_id is None:
            return False
        if role is not None and self.role != role:
            return False
        if permission is not None and not self.has_permission(permission):
            return False
        if team_id is not None and not self.has_team(team_id):
            return False
        return True

    @classmethod
    def from_claim(cls, raw: Any) -> "Membership | None":
        """Decode the ``membership`` claim, or return None when there is none."""
        if not isinstance(raw, Mapping):
            return None

        role = raw.get("role")
        role = role if isinstance(role, str) else ""

        # Non-string entries are DROPPED rather than failing the whole claim, so
        # one malformed entry cannot deny an otherwise valid membership.
        permissions = tuple(
            entry for entry in _as_sequence(raw.get("permissions")) if isinstance(entry, str)
        )
        raw_teams = raw.get("teams")
        teams: tuple[str, ...] | None = None
        if isinstance(raw_teams, Sequence) and not isinstance(raw_teams, (str, bytes)):
            teams = tuple(entry for entry in raw_teams if isinstance(entry, str))

        if not role and not permissions and not teams:
            return None
        return cls(role=role, permissions=permissions, teams=teams)


def _as_sequence(value: Any) -> Sequence[Any]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return value
    return ()


def membership_has(membership: "Membership | None", **query: Any) -> bool:
    """Module-level ``has()`` that treats a missing membership as a denial."""
    if membership is None:
        return False
    return membership.has(**query)


def membership_has_permission(membership: "Membership | None", permission: str) -> bool:
    """Module-level ``has_permission()`` that treats a missing membership as a denial."""
    if membership is None:
        return False
    return membership.has_permission(permission)
