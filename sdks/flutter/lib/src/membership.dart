/// Pure evaluators for AuthOwl organization membership claims.
///
/// No I/O: every decision is made against the claim a verified token already
/// carries, so the client and server paths can never disagree about what a
/// membership grants.
library;

/// The active-organization membership carried by a verified token.
class Membership {
  const Membership({this.role = '', this.permissions = const [], this.teams});

  /// Canonical role key (`owner`/`admin`/`member`, or a project role).
  final String role;

  /// Effective permission ids: `org:sys_*` system claims plus the operator's
  /// custom `org:<feature>:<action>` ids.
  final List<String> permissions;

  /// Team ids held inside the ACTIVE organization.
  ///
  /// `null` (not an empty list) when the token carries no `teams` claim at all,
  /// which is what a token minted before teams shipped looks like. An absent
  /// claim is never read as "any team".
  final List<String>? teams;

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
    if (role != null && this.role != role) return false;
    if (permission != null && !hasPermission(permission)) return false;
    if (teamId != null && !hasTeam(teamId)) return false;
    return true;
  }

  /// Decode the `membership` claim, or return null when the token carries none.
  static Membership? fromClaim(Object? raw) {
    if (raw is! Map) return null;

    final role = raw['role'] is String ? raw['role'] as String : '';
    final permissions = _stringList(raw['permissions']) ?? const <String>[];
    // Absent stays null so has(teamId:) can never be satisfied by a claim that
    // never mentioned teams.
    final teams = _stringList(raw['teams']);

    if (role.isEmpty &&
        permissions.isEmpty &&
        (teams == null || teams.isEmpty)) {
      return null;
    }
    return Membership(role: role, permissions: permissions, teams: teams);
  }

  /// Non-string entries are DROPPED rather than failing the whole claim, so one
  /// malformed entry cannot deny an otherwise valid membership.
  static List<String>? _stringList(Object? value) {
    if (value is! List) return null;
    return value.whereType<String>().toList(growable: false);
  }

  @override
  String toString() =>
      'Membership(role: $role, permissions: $permissions, teams: $teams)';
}
