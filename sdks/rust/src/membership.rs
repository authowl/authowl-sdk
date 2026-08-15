//! Pure evaluators for an organization membership claim.
//!
//! No I/O: every decision is made against the claim a verified token already
//! carries, so the client and server paths can never disagree about what a
//! membership grants.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The active-organization membership carried by a verified token.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Membership {
    /// Canonical role key (`owner`/`admin`/`member`, or a project role).
    #[serde(default)]
    pub role: String,
    /// Effective permission ids: `org:sys_*` system claims plus the operator's
    /// custom `org:<feature>:<action>` ids.
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Team ids held inside the ACTIVE organization.
    ///
    /// `None` (not an empty vec) when the token carries no `teams` claim at all,
    /// which is what a token minted before teams shipped looks like. An absent
    /// claim is never read as "any team".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub teams: Option<Vec<String>>,
}

/// A Clerk-style `has()` query. Every `Some` field must hold (AND).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Query<'a> {
    pub role: Option<&'a str>,
    pub permission: Option<&'a str>,
    pub team_id: Option<&'a str>,
}

impl<'a> Query<'a> {
    pub fn role(role: &'a str) -> Self {
        Self {
            role: Some(role),
            ..Default::default()
        }
    }

    pub fn permission(permission: &'a str) -> Self {
        Self {
            permission: Some(permission),
            ..Default::default()
        }
    }

    pub fn team(team_id: &'a str) -> Self {
        Self {
            team_id: Some(team_id),
            ..Default::default()
        }
    }

    pub fn and_role(mut self, role: &'a str) -> Self {
        self.role = Some(role);
        self
    }

    pub fn and_permission(mut self, permission: &'a str) -> Self {
        self.permission = Some(permission);
        self
    }

    pub fn and_team(mut self, team_id: &'a str) -> Self {
        self.team_id = Some(team_id);
        self
    }
}

impl Membership {
    /// Whether the permission claim includes `permission`. Exact match only.
    pub fn has_permission(&self, permission: &str) -> bool {
        if permission.is_empty() {
            return false;
        }
        self.permissions.iter().any(|held| held == permission)
    }

    /// Whether the team claim includes `team_id`.
    ///
    /// Teams are pure grouping: belonging to one grants nothing on its own, so
    /// this is for the application's own gating, never an authority check.
    pub fn has_team(&self, team_id: &str) -> bool {
        if team_id.is_empty() {
            return false;
        }
        match &self.teams {
            Some(teams) => teams.iter().any(|held| held == team_id),
            None => false,
        }
    }

    /// Whether the membership satisfies EVERY criterion in the query.
    ///
    /// Asking nothing grants nothing: an empty query returns false.
    pub fn has(&self, query: &Query<'_>) -> bool {
        if query.role.is_none() && query.permission.is_none() && query.team_id.is_none() {
            return false;
        }
        if let Some(role) = query.role {
            if self.role != role {
                return false;
            }
        }
        if let Some(permission) = query.permission {
            if !self.has_permission(permission) {
                return false;
            }
        }
        if let Some(team_id) = query.team_id {
            if !self.has_team(team_id) {
                return false;
            }
        }
        true
    }

    /// Decode the `membership` claim, or `None` when the token carries none.
    pub(crate) fn from_claim(raw: Option<&Value>) -> Option<Self> {
        let object = raw?.as_object()?;

        let role = object
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let permissions = string_list(object.get("permissions")).unwrap_or_default();
        // Absent stays None so `has(team_id)` can never be satisfied by a claim
        // that never mentioned teams.
        let teams = string_list(object.get("teams"));

        let teams_empty = teams.as_ref().map_or(true, Vec::is_empty);
        if role.is_empty() && permissions.is_empty() && teams_empty {
            return None;
        }
        Some(Self {
            role,
            permissions,
            teams,
        })
    }
}

/// Non-string entries are DROPPED rather than failing the whole claim, so one
/// malformed entry cannot deny an otherwise valid membership.
fn string_list(value: Option<&Value>) -> Option<Vec<String>> {
    let entries = value?.as_array()?;
    Some(
        entries
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
    )
}

/// Module-level `has()` that treats a missing membership as a denial.
pub fn membership_has(membership: Option<&Membership>, query: &Query<'_>) -> bool {
    membership.is_some_and(|m| m.has(query))
}

/// Module-level `has_permission()` that treats a missing membership as a denial.
pub fn membership_has_permission(membership: Option<&Membership>, permission: &str) -> bool {
    membership.is_some_and(|m| m.has_permission(permission))
}
