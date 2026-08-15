/// Bounded HTTP transport with a single-cookie session jar.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../cookie.dart';
import 'projection.dart';
import 'storage.dart';

/// Ceiling on a response body. A hostile or misconfigured endpoint should not
/// be able to exhaust memory on a phone.
const int maxResponseBytes = 1024 * 1024;
const Duration requestTimeout = Duration(seconds: 15);

/// The `{data, error}` envelope every auth action returns.
///
/// Errors are values rather than exceptions because almost every auth failure
/// is expected control flow - wrong password, expired code, rate limited - and
/// forcing a try/catch around each call makes the common path noisy.
class AuthResult<T> {
  const AuthResult({this.data, this.error});

  final T? data;
  final AuthError? error;

  bool get isSuccess => error == null;
}

/// Refuse an API origin that would carry credentials in the clear.
///
/// Returns whether the origin is secure, which also decides the session cookie
/// name (`__Secure-` prefixed or not).
///
/// A plain-HTTP origin is not merely a different cookie name: passwords, OTP
/// codes, and the stored session cookie would all travel unencrypted, so a
/// production typo like `http://api.example.com` silently becomes a credential
/// leak. Loopback is the one exception, and only when the caller opts in -
/// matching the TypeScript SDK, which allows it for test-environment keys so
/// local development against `http://localhost` still works.
bool _requireSafeOrigin(String apiUrl, bool allowHttpLoopback) {
  final uri = Uri.tryParse(apiUrl);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    throw ArgumentError.value(
        apiUrl, 'apiUrl', 'must be an absolute http(s) URL');
  }
  if (uri.scheme == 'https') return true;
  if (uri.scheme == 'http' && allowHttpLoopback && _isLoopback(uri.host)) {
    return false;
  }
  throw ArgumentError.value(
    apiUrl,
    'apiUrl',
    'must use https. Plain http would send credentials in the clear; it is '
        'permitted only for loopback development origins with a pk_test_ key',
  );
}

bool _isLoopback(String host) {
  final bare = host.startsWith('[') && host.endsWith(']')
      ? host.substring(1, host.length - 1)
      : host;
  return bare == 'localhost' || bare == '127.0.0.1' || bare == '::1';
}

/// Raised internally when a response exceeds the byte ceiling mid-read.
class _ResponseTooLarge implements Exception {
  const _ResponseTooLarge();
}

/// A failed auth action.
class AuthError {
  const AuthError({this.message, this.code, this.status, this.requestId});

  final String? message;
  final String? code;
  final int? status;
  final String? requestId;

  @override
  String toString() =>
      'AuthError(${code ?? status ?? 'unknown'}: ${message ?? ''})';
}

/// Talks to one project's auth API, persisting the session cookie itself.
///
/// Why a hand-rolled jar: the AuthOwl server authenticates with a session
/// COOKIE, and browsers do that automatically. Flutter HTTP clients do not share
/// a durable cookie store across platforms or app restarts, so the client keeps
/// the one cookie it cares about in secure storage, replays it on every
/// request, and re-captures it whenever the server rotates it. The server sees
/// exactly what a browser would send, so no server-side "native mode" exists.
class AuthOwlTransport {
  AuthOwlTransport({
    required this.apiUrl,
    required this.publishableKey,
    required this.projectId,
    required this.storage,
    bool allowHttpLoopback = false,
    http.Client? httpClient,
  })  : _ownsHttpClient = httpClient == null,
        _http = httpClient ?? http.Client(),
        _secure = _requireSafeOrigin(apiUrl, allowHttpLoopback),
        _baseUrl = '$apiUrl/api/projects/$projectId/auth',
        _publicConfigUrl = '$apiUrl/api/projects/$projectId/public-config';

  final String apiUrl;
  final String publishableKey;
  final String projectId;
  final AuthOwlStorage storage;
  final http.Client _http;
  final bool _ownsHttpClient;
  final bool _secure;
  final String _baseUrl;
  final String _publicConfigUrl;

  String get _cookieName => sessionCookieName(projectId, secure: _secure);
  String get storageKey => 'authowl.session.$projectId';

  /// Whether a session cookie is currently held. Does not prove it is valid.
  Future<bool> hasStoredSession() async =>
      (await storage.read(storageKey))?.isNotEmpty ?? false;

  Future<void> clearStoredSession() => storage.delete(storageKey);

  /// Issue a request, replaying and capturing the session cookie around it.
  Future<AuthResult<Object?>> send(
    String path, {
    String method = 'POST',
    Map<String, Object?>? body,
    Map<String, String>? query,
  }) =>
      _send(
        Uri.parse('$_baseUrl$path').replace(
          queryParameters: query == null || query.isEmpty ? null : query,
        ),
        projectionPath: path,
        method: method,
        body: body,
        includeSession: true,
      );

  /// Fetch publishable project policy without replaying or capturing a session.
  Future<AuthResult<Object?>> getPublicConfig() => _send(
        Uri.parse(_publicConfigUrl),
        projectionPath: '/public-config',
        method: 'GET',
        includeSession: false,
      );

  Future<AuthResult<Object?>> _send(
    Uri uri, {
    required String projectionPath,
    required String method,
    required bool includeSession,
    Map<String, Object?>? body,
  }) async {
    final headers = <String, String>{
      'accept': 'application/json',
      'x-publishable-key': publishableKey,
    };
    final stored = includeSession ? await storage.read(storageKey) : null;
    if (stored != null && stored.isNotEmpty) {
      headers['cookie'] = '$_cookieName=$stored';
    }
    if (body != null) headers['content-type'] = 'application/json';

    int statusCode;
    List<String> setCookieValues;
    String bodyText;
    try {
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) request.body = jsonEncode(body);
      // Redirects are refused rather than followed: an auth response that
      // redirects is not something a native client should chase, and following
      // one could replay the session cookie to an unintended origin.
      request.followRedirects = false;
      final streamed = await _http.send(request).timeout(requestTimeout);
      statusCode = streamed.statusCode;
      // Each Set-Cookie header kept SEPARATE. `headers` comma-joins repeated
      // headers, and a response that sets another cookie before the session one
      // would then hide it behind a comma - sign-in would appear to succeed
      // while nothing was ever persisted.
      setCookieValues = streamed.headersSplitValues['set-cookie'] ?? const [];
      bodyText = await _readBounded(streamed.stream).timeout(requestTimeout);
    } on TimeoutException {
      return const AuthResult(
          error: AuthError(code: 'TIMEOUT', message: 'The request timed out.'));
    } on _ResponseTooLarge {
      return const AuthResult(
        error: AuthError(
            code: 'RESPONSE_TOO_LARGE', message: 'The response was too large.'),
      );
    } catch (_) {
      return const AuthResult(
          error: AuthError(code: 'NETWORK', message: 'The request failed.'));
    }

    if (includeSession) await _captureSessionCookie(setCookieValues);

    Object? payload;
    if (bodyText.isNotEmpty) {
      try {
        payload = jsonDecode(bodyText);
      } on FormatException {
        return const AuthResult(
          error: AuthError(
              code: 'INVALID_RESPONSE',
              message: 'The response was not valid JSON.'),
        );
      }
    }

    if (statusCode < 200 || statusCode > 299) {
      return AuthResult(error: _errorFrom(statusCode, payload));
    }
    // Strip the durable session token before anything downstream sees it.
    return AuthResult(data: projectAuthPayload(projectionPath, payload));
  }

  /// Read the body, refusing to buffer more than the ceiling.
  ///
  /// The cap is enforced DURING the read, not after. Reading the whole stream
  /// first and then checking its length is a cap that cannot work: by the time
  /// the length is known the memory has already been committed, which on a
  /// phone is exactly the failure it is supposed to prevent.
  Future<String> _readBounded(Stream<List<int>> stream) async {
    final buffer = <int>[];
    await for (final chunk in stream) {
      buffer.addAll(chunk);
      if (buffer.length > maxResponseBytes) throw const _ResponseTooLarge();
    }
    return utf8.decode(buffer, allowMalformed: true);
  }

  Future<void> _captureSessionCookie(List<String> setCookieValues) async {
    final issued = readSetCookie(setCookieValues, _cookieName);
    if (issued == null) return;
    // An empty value is the server clearing the cookie (sign-out). Removing it
    // rather than storing "" keeps the next read honest.
    if (issued.isEmpty) {
      await storage.delete(storageKey);
    } else {
      await storage.write(storageKey, issued);
    }
  }

  AuthError _errorFrom(int status, Object? payload) {
    if (payload is Map) {
      return AuthError(
        message: payload['message'] as String?,
        code: (payload['code'] ?? payload['type']) as String?,
        status: status,
        requestId: payload['requestId'] as String?,
      );
    }
    return AuthError(status: status, message: 'Request failed ($status).');
  }

  void close() {
    if (_ownsHttpClient) _http.close();
  }
}

/// Parse one named cookie out of the response's `Set-Cookie` headers.
///
/// Takes the values as a LIST because a response may set several cookies, each
/// in its own header. Joining them into one string and splitting again is not
/// safe: a `Set-Cookie` value legitimately contains commas (in `Expires`), so
/// the join is ambiguous and the session cookie can be lost behind another one.
///
/// Deliberately narrow otherwise: this client talks to a single origin and
/// cares about a single cookie, so modelling domains and paths would be a lot
/// of surface for no benefit. Returns null when none of the headers set the
/// cookie, and the empty string when the server clears it.
String? readSetCookie(List<String> setCookieValues, String name) {
  for (final value in setCookieValues) {
    // A single value may still arrive newline-joined from some clients.
    for (final entry in value.split('\n')) {
      final trimmed = entry.trim();
      final separator = trimmed.indexOf('=');
      if (separator == -1) continue;
      if (trimmed.substring(0, separator).trim() != name) continue;
      return trimmed.substring(separator + 1).split(';').first;
    }
  }
  return null;
}
