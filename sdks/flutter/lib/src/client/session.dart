/// Reactive AuthOwl session state.
library;

import 'dart:async';

import '../membership.dart';
import 'transport.dart';

/// The signed-in user, as the client surfaces it.
class AuthOwlUser {
  const AuthOwlUser({
    required this.id,
    this.email,
    this.phoneNumber,
    this.username,
    this.firstName,
    this.lastName,
    this.name,
    this.image,
    this.emailVerified = false,
    this.twoFactorEnabled = false,
  });

  final String id;
  final String? email;
  final String? phoneNumber;
  final String? username;
  final String? firstName;
  final String? lastName;
  final String? name;
  final String? image;
  final bool emailVerified;
  final bool twoFactorEnabled;

  static AuthOwlUser? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    if (id is! String || id.isEmpty) return null;
    return AuthOwlUser(
      id: id,
      email: raw['email'] as String?,
      phoneNumber: raw['phoneNumber'] as String?,
      username: raw['username'] as String?,
      firstName: raw['firstName'] as String?,
      lastName: raw['lastName'] as String?,
      name: raw['name'] as String?,
      image: raw['image'] as String?,
      emailVerified: raw['emailVerified'] == true,
      twoFactorEnabled: raw['twoFactorEnabled'] == true,
    );
  }
}

/// The active session, without its durable token - that never leaves the jar.
class AuthOwlSession {
  const AuthOwlSession({
    required this.id,
    this.activeOrganizationId,
    this.activeTeamId,
    this.membership,
    this.pendingMfaEnrollment = false,
  });

  final String id;
  final String? activeOrganizationId;
  final String? activeTeamId;
  final Membership? membership;

  /// True while the project requires MFA and the user has not enrolled. Such a
  /// session is NOT usable as authentication - treat it as signed out until
  /// enrolment completes.
  final bool pendingMfaEnrollment;

  static AuthOwlSession? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    if (id is! String || id.isEmpty) return null;
    return AuthOwlSession(
      id: id,
      activeOrganizationId: raw['activeOrganizationId'] as String?,
      activeTeamId: raw['activeTeamId'] as String?,
      membership: Membership.fromClaim(raw['membership']),
      pendingMfaEnrollment: raw['pendingMfaEnrollment'] == true,
    );
  }
}

/// A snapshot of who is signed in.
class AuthOwlSessionState {
  const AuthOwlSessionState({
    this.user,
    this.session,
    this.isLoading = false,
    this.error,
  });

  final AuthOwlUser? user;
  final AuthOwlSession? session;
  final bool isLoading;
  final AuthError? error;

  /// A session held at required-MFA enrolment is deliberately NOT signed in:
  /// treating it as authenticated would let an app skip the enrolment gate.
  bool get isSignedIn =>
      session != null && user != null && !session!.pendingMfaEnrollment;
}

/// Holds the current session and notifies listeners when it changes.
class AuthOwlSessionStore {
  AuthOwlSessionStore(this._transport);

  final AuthOwlTransport _transport;
  final _controller = StreamController<AuthOwlSessionState>.broadcast();
  AuthOwlSessionState _state = const AuthOwlSessionState(isLoading: true);

  AuthOwlSessionState get state => _state;

  /// Emits on every change. Broadcast, so any number of widgets can listen.
  Stream<AuthOwlSessionState> get changes => _controller.stream;

  void _publish(AuthOwlSessionState next) {
    _state = next;
    if (!_controller.isClosed) _controller.add(next);
  }

  /// Re-read the session from the server.
  ///
  /// Skips the round trip entirely when no cookie is stored: an app launching
  /// signed-out should not pay a request to be told so.
  Future<AuthOwlSessionState> refresh({bool force = false}) async {
    if (!force && !await _transport.hasStoredSession()) {
      final next = const AuthOwlSessionState();
      _publish(next);
      return next;
    }
    _publish(AuthOwlSessionState(
      user: _state.user,
      session: _state.session,
      isLoading: true,
    ));

    // `force` follows an action that may have changed the session, so the
    // server's cookie cache has to be bypassed as well as the local shortcut.
    // Without this, completing MFA enrolment or switching the active
    // organization can return the pre-change snapshot, leaving
    // `pendingMfaEnrollment` or membership stale (CONTRACTS section 5).
    final result = await _transport.send(
      '/get-session',
      method: 'GET',
      query: force ? const {'disableCookieCache': 'true'} : null,
    );
    if (result.error != null) {
      final next = AuthOwlSessionState(error: result.error);
      _publish(next);
      return next;
    }
    final data = result.data;
    if (data is! Map) {
      // A null body is the server's way of saying "no session".
      await _transport.clearStoredSession();
      const next = AuthOwlSessionState();
      _publish(next);
      return next;
    }
    final next = AuthOwlSessionState(
      user: AuthOwlUser.fromJson(data['user']),
      session: AuthOwlSession.fromJson(data['session']),
    );
    _publish(next);
    return next;
  }

  /// Drop the local session without contacting the server.
  Future<void> clear() async {
    await _transport.clearStoredSession();
    _publish(const AuthOwlSessionState());
  }

  Future<void> dispose() => _controller.close();
}
