/// Pure evaluators for AuthOwl organization membership claims.
///
/// No I/O: every decision is made against the claim a verified token already
/// carries, so the client and server paths can never disagree about what a
/// membership grants.
library;

/// The active-organization membership carried by a verified token.
class Membership {
  const Membership({
    this.role = '',
    this.roles,
    this.permissions = const [],
    this.teams,
  });

  /// Primary role key (`owner`/`admin`/`member`, or a project role).
  final String role;

  /// Every role the member holds.
  ///
  /// `null` (not an empty list) when the token carries no `roles` claim, which
  /// is what an older AuthOwl token looks like. Role checks then fall back to
  /// the primary [role] rather than reporting no role held.
  final List<String>? roles;

  /// Effective permission ids: `org:sys_*` system claims plus the operator's
  /// custom `org:<feature>:<action>` ids.
  final List<String> permissions;

  /// Team ids held inside the ACTIVE organization.
  ///
  /// `null` (not an empty list) when the token carries no `teams` claim at all,
  /// which is what a token minted before teams shipped looks like. An absent
  /// claim is never read as "any team".
  final List<String>? teams;

  /// Whether the member holds [role] as one of their roles.
  bool hasRole(String role) {
    final heldRoles = roles;
    if (heldRoles == null) return this.role == role;
    return heldRoles.contains(role);
  }

  /// Whether the permission claim includes [permission]. Exact match only.
  bool hasPermission(String permission) {
    if (permission.isEmpty) return false;
    return permissions.contains(permission);
  }

  /// Whether the team claim includes [teamId].
  ///
  /// Teams are pure grouping: belonging to one grants nothing on its own, so
  /// this is for the application's own gating, never an authority check.
  bool hasTeam(String teamId) {
    if (teamId.isEmpty) return false;
    return teams?.contains(teamId) ?? false;
  }

  /// Whether the membership satisfies EVERY supplied criterion (AND).
  ///
  /// Asking nothing grants nothing: a query with no criteria returns false.
  bool has({String? role, String? permission, String? teamId}) {
    if (role == null && permission == null && teamId == null) return false;
    if (role != null && !hasRole(role)) return false;
    if (permission != null && !hasPermission(permission)) return false;
    if (teamId != null && !hasTeam(teamId)) return false;
    return true;
  }

  /// Decode the `membership` claim, or return null when the token carries none.
  static Membership? fromClaim(Object? raw) {
    if (raw is! Map) return null;

    final role = raw['role'] is String ? raw['role'] as String : '';
    final permissions = _stringList(raw['permissions']) ?? const <String>[];
    // Absent stays null so teams cannot match a claim that never mentioned
    // them, and roles can fall back to the primary only for older tokens.
    final teams = _stringList(raw['teams']);
    final roles = _stringList(raw['roles']);

    if (role.isEmpty &&
        permissions.isEmpty &&
        (teams == null || teams.isEmpty) &&
        (roles == null || roles.isEmpty)) {
      return null;
    }
    return Membership(
      role: role,
      roles: roles,
      permissions: permissions,
      teams: teams,
    );
  }

  /// Non-string entries are DROPPED rather than failing the whole claim, so one
  /// malformed entry cannot deny an otherwise valid membership.
  static List<String>? _stringList(Object? value) {
    if (value is! List) return null;
    return value.whereType<String>().toList(growable: false);
  }

  @override
  String toString() =>
      'Membership(role: $role, roles: $roles, permissions: $permissions, teams: $teams)';
}
