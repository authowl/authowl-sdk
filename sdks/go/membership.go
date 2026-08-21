package authowl

// Membership is the active-organization membership carried by a verified token.
type Membership struct {
	// Role is the member's PRIMARY role key (owner/admin/member or a project
	// role). One value, for display - use Has to gate, because a member can hold
	// more than one.
	Role string `json:"role"`
	// Roles is EVERY role the member holds, sorted. `member.role` is a
	// comma-separated set server-side, so `admin,editor` is an ordinary
	// membership, and gating on Role alone made the others invisible.
	//
	// Nil (not empty) when the token carries no `roles` claim, which is what a
	// token minted by an older AuthOwl looks like. HasRole then falls back to
	// Role rather than reporting the member holds nothing.
	Roles []string `json:"roles,omitempty"`
	// Permissions holds the effective permission ids: `org:sys_*` system claims
	// plus the operator's custom `org:<feature>:<action>` ids.
	Permissions []string `json:"permissions"`
	// Teams are the team ids held inside the ACTIVE organization.
	//
	// Nil (not empty) when the token carries no `teams` claim at all, which is
	// what a token minted before teams shipped looks like. HasTeam then reports
	// false rather than guessing: an absent claim is never read as "any team".
	Teams []string `json:"teams,omitempty"`
}

// Query is a Clerk-style has() query. Every present field must hold (AND).
// Pointers preserve the difference between an omitted criterion and an explicit
// empty string, which must deny rather than silently disappearing.
type Query struct {
	Role       *string `json:"role,omitempty"`
	Permission *string `json:"permission,omitempty"`
	TeamID     *string `json:"teamId,omitempty"`
}

// HasRole reports whether the member holds role - as ONE OF their roles, not
// merely as the primary one.
//
// When the token carries a `roles` claim it is the only thing consulted: the
// primary is already a member of that set, so checking it separately would make
// a membership whose set does not contain it match anyway. Falls back to the
// primary only when the claim is absent, which is what an older AuthOwl mints.
func (m *Membership) HasRole(role string) bool {
	if m == nil {
		return false
	}
	if m.Roles == nil {
		return m.Role == role
	}
	for _, held := range m.Roles {
		if held == role {
			return true
		}
	}
	return false
}

// Match marks a Query criterion as present. An empty value remains present and
// therefore fails closed instead of being treated as omitted.
func Match(value string) *string {
	return &value
}

// HasPermission reports whether the membership's permission claim includes
// permission. Exact match only - no prefix or substring matching.
func (m *Membership) HasPermission(permission string) bool {
	if m == nil || permission == "" {
		return false
	}
	for _, held := range m.Permissions {
		if held == permission {
			return true
		}
	}
	return false
}

// HasTeam reports whether the membership's team claim includes teamID.
//
// Teams are pure grouping: belonging to one grants nothing on its own, so this
// is for the application's own gating, never an authority check.
func (m *Membership) HasTeam(teamID string) bool {
	if m == nil || teamID == "" {
		return false
	}
	for _, held := range m.Teams {
		if held == teamID {
			return true
		}
	}
	return false
}

// Has reports whether the membership satisfies EVERY criterion in the query.
// Returns false when there is no membership, and false for an empty query -
// asking nothing never grants anything.
func (m *Membership) Has(query Query) bool {
	if m == nil {
		return false
	}
	if query.Role == nil && query.Permission == nil && query.TeamID == nil {
		return false
	}
	if query.Role != nil && !m.HasRole(*query.Role) {
		return false
	}
	if query.Permission != nil && !m.HasPermission(*query.Permission) {
		return false
	}
	if query.TeamID != nil && !m.HasTeam(*query.TeamID) {
		return false
	}
	return true
}
