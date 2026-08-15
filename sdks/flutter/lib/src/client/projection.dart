/// Removes the auth engine's durable session token from responses.
library;

/// Strip the engine's long-lived session token out of the exact response
/// families that carry one.
///
/// The durable token is a bearer credential: anything holding it *is* the
/// signed-in user until it expires. This client keeps it in the cookie jar and
/// nowhere else, so it is removed before any response reaches application
/// state, a log line, or an error report.
///
/// The rule is narrow on purpose. Password reset and account deletion carry a
/// `token` as an INPUT, and the separate short-lived `/token` JWT is a different
/// credential entirely - stripping either would break a working flow. Behaviour
/// is pinned by `conformance/vectors/response-projection.json`, which every
/// AuthOwl SDK re-verifies, because a client that forgets one path leaks a
/// session credential without failing anything else.
Object? projectAuthPayload(String path, Object? payload) {
  if (path == '/list-sessions' && payload is List) {
    return payload
        .map((entry) => entry is Map ? _withoutToken(entry) : entry)
        .toList(growable: false);
  }
  if (payload is! Map) return payload;

  final stripsTopLevelToken = path == '/change-password' ||
      path == '/passkey/verify-authentication' ||
      path == '/phone-otp/verify' ||
      path == '/sign-up/email' ||
      path.startsWith('/sign-in/') ||
      path.startsWith('/two-factor/verify-');

  var projected =
      stripsTopLevelToken ? _withoutToken(payload) : _asMap(payload);

  if (path == '/sign-up/email' && !projected.containsKey('sessionCreated')) {
    final token = payload['token'];
    projected = {
      ...projected,
      // The token was just stripped, so the ONLY remaining signal that sign-up
      // established a session is whether one was present before stripping.
      'sessionCreated': token is String && token.isNotEmpty,
    };
  }

  if ((path == '/get-session' || path == '/passkey/verify-authentication') &&
      projected['session'] is Map) {
    projected = {
      ...projected,
      'session': _withoutToken(projected['session'] as Map),
    };
  }
  return projected;
}

Map<String, Object?> _asMap(Map value) =>
    value.map((key, entry) => MapEntry(key.toString(), entry));

Map<String, Object?> _withoutToken(Map value) {
  final projected = _asMap(value);
  projected.remove('token');
  return projected;
}
