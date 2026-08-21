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
    /// Primary role key (`owner`/`admin`/`member`, or a project role).
    #[serde(default)]
    pub role: String,
    /// Every role the member holds.
    ///
    /// `None` (not an empty vec) when the token carries no `roles` claim, which
    /// is what an older AuthOwl token looks like. Role checks then fall back to
    /// the primary [`Membership::role`] rather than reporting no role held.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roles: Option<Vec<String>>,
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
    /// Whether the member holds `role` as one of their roles.
    pub fn has_role(&self, role: &str) -> bool {
        match &self.roles {
            Some(roles) => roles.iter().any(|held| held == role),
            None => self.role == role,
        }
    }

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
            if !self.has_role(role) {
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
        // Absent stays None so teams cannot match a claim that never mentioned
        // them, and roles can fall back to the primary only for older tokens.
        let teams = string_list(object.get("teams"));
        let roles = string_list(object.get("roles"));

        let teams_empty = teams.as_ref().map_or(true, Vec::is_empty);
        let roles_empty = roles.as_ref().map_or(true, Vec::is_empty);
        if role.is_empty() && permissions.is_empty() && teams_empty && roles_empty {
            return None;
        }
        Some(Self {
            role,
            roles,
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
