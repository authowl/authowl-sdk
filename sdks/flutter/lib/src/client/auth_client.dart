/// The AuthOwl client authentication surface for Flutter apps.
library;

import 'package:http/http.dart' as http;

import '../publishable_key.dart';
import 'phone_otp.dart';
import 'session.dart';
import 'storage.dart';
import 'transport.dart';
import 'public_config.dart';

/// The server-side action a challenge token must be minted for.
enum AuthOwlChallengeAction {
  signIn('auth_signin'),
  signUp('auth_signup'),
  passwordless('auth_passwordless'),
  passwordReset('auth_reset'),
  verificationEmail('auth_verify_email');

  const AuthOwlChallengeAction(this.value);

  final String value;
}

/// Mints a fresh, single-use bot-challenge token for a built-in auth form.
typedef AuthOwlChallengeTokenProvider = Future<String?> Function(
  AuthOwlChallengeAction action,
);

/// Signs users in, keeps the session, and exposes account and organization
/// actions.
///
/// Paths and methods come from `conformance/client-surface.json`, which is
/// derived from `@authowl/core` and drift-checked in CI, so this client and the
/// JavaScript one cannot silently disagree about the API they call.
class AuthOwlClient {
  AuthOwlClient._(this._transport, this.session, this.projectId);

  /// Build a client for a project.
  ///
  /// Throws if handed a secret key: a `sk_` key in an app binary cannot be
  /// rotated out of users' hands, so it fails here rather than shipping.
  factory AuthOwlClient({
    required String publishableKey,
    required String apiUrl,
    required AuthOwlStorage storage,

    /// Injectable for tests and for apps that need their own HTTP stack
    /// (custom certificates, proxies, instrumentation). The caller retains
    /// ownership; disposing AuthOwl does not close an injected client.
    http.Client? httpClient,
  }) {
    final key = decodePublishableKey(publishableKey);
    final transport = AuthOwlTransport(
      apiUrl: apiUrl,
      publishableKey: publishableKey,
      projectId: key.projectId,
      storage: storage,
      // Only a test key may talk to a loopback origin over plain http. A live
      // key doing so would be shipping credentials in the clear.
      allowHttpLoopback: key.env == AuthOwlEnvironment.test,
      httpClient: httpClient,
    );
    return AuthOwlClient._(
        transport, AuthOwlSessionStore(transport), key.projectId);
  }

  final AuthOwlTransport _transport;
  final AuthOwlSessionStore session;
  final String projectId;

  // -- sign in ---------------------------------------------------------------

  Future<AuthResult<Object?>> signInWithEmail({
    required String email,
    required String password,
    bool rememberMe = true,
    String? challengeToken,
  }) =>
      _mutating(
          '/sign-in/email',
          {
            'email': email,
            'password': password,
            'rememberMe': rememberMe,
          },
          challengeToken: challengeToken);

  Future<AuthResult<Object?>> signInWithUsername({
    required String username,
    required String password,
    bool rememberMe = true,
  }) =>
      _mutating('/sign-in/username', {
        'username': username,
        'password': password,
        'rememberMe': rememberMe,
      });

  /// Social sign-in with a token from the provider's NATIVE SDK
  /// (`google_sign_in`, `sign_in_with_apple`).
  ///
  /// Redirect OAuth is deliberately unsupported: it completes inside a system
  /// browser whose cookie jar this client cannot read, so the session cookie
  /// would be set somewhere the app can never see it and sign-in would appear
  /// to succeed while leaving the user signed out.
  Future<AuthResult<Object?>> signInWithIdToken({
    required String provider,
    required String idToken,
    String? accessToken,
    String? nonce,
  }) =>
      _mutating('/sign-in/social', {
        'provider': provider,
        'disableRedirect': true,
        'idToken': {
          'token': idToken,
          if (accessToken != null) 'accessToken': accessToken,
          if (nonce != null) 'nonce': nonce,
        },
      });

  Future<AuthResult<Object?>> sendMagicLink({
    required String email,
    String? callbackURL,
    String? challengeToken,
  }) =>
      _transport
          .send('/sign-in/magic-link', challengeToken: challengeToken, body: {
        'email': email,
        if (callbackURL != null) 'callbackURL': callbackURL,
      });

  Future<AuthResult<Object?>> sendEmailOtp({
    required String email,
    String? challengeToken,
  }) =>
      _transport.send('/email-otp/send-verification-otp',
          challengeToken: challengeToken,
          body: {
            'email': email,
            'type': 'sign-in',
          });

  Future<AuthResult<Object?>> signInWithEmailOtp({
    required String email,
    required String otp,
  }) =>
      _mutating('/sign-in/email-otp', {'email': email, 'otp': otp});

  // -- sign up ---------------------------------------------------------------

  Future<AuthResult<Object?>> signUpWithEmail({
    required String email,
    required String password,
    String? name,
    String? username,
    String? firstName,
    String? lastName,
    int? consentVersion,
    String? challengeToken,
  }) =>
      _mutating(
          '/sign-up/email',
          {
            'email': email,
            'password': password,
            if (name != null) 'name': name,
            if (username != null) 'username': username,
            if (firstName != null) 'firstName': firstName,
            if (lastName != null) 'lastName': lastName,
            if (consentVersion != null) 'consentVersion': consentVersion,
          },
          challengeToken: challengeToken);

  // -- phone -----------------------------------------------------------------

  /// Discover the provider-neutral anti-abuse ceremony selected by the server.
  Future<AuthResult<PhoneOtpChallenge>> preparePhoneOtp() async {
    final result =
        await _transport.send('/phone-otp/challenge', body: const {});
    if (result.error != null) return AuthResult(error: result.error);
    final challenge = PhoneOtpChallenge.fromJson(result.data);
    if (challenge == null) {
      return const AuthResult(
        error: AuthError(
          code: 'INVALID_RESPONSE',
          message: 'The server returned an invalid phone OTP challenge.',
        ),
      );
    }
    return AuthResult(data: challenge);
  }

  Future<AuthResult<Object?>> startPhoneOtp({
    required String phoneNumber,
    required String idempotencyKey,
    String? turnstileToken,
    AkedlyShieldProof? akedlyShield,
  }) =>
      _transport.send('/phone-otp/start', body: {
        'phoneNumber': phoneNumber,
        'idempotencyKey': idempotencyKey,
        if (turnstileToken != null) 'turnstileToken': turnstileToken,
        if (akedlyShield != null) 'akedlyShield': akedlyShield.toJson(),
      });

  Future<AuthResult<Object?>> verifyPhoneOtp({
    required String phoneNumber,
    required String code,
  }) =>
      _mutating(
          '/phone-otp/verify', {'phoneNumber': phoneNumber, 'code': code});

  // -- two factor ------------------------------------------------------------

  Future<AuthResult<Object?>> verifyTotp({required String code}) =>
      _mutating('/two-factor/verify-totp', {'code': code});

  Future<AuthResult<Object?>> verifyBackupCode({required String code}) =>
      _mutating('/two-factor/verify-backup-code', {'code': code});

  Future<AuthResult<Object?>> sendTwoFactorOtp() =>
      _transport.send('/two-factor/send-otp', body: const {});

  Future<AuthResult<Object?>> verifyTwoFactorOtp({required String code}) =>
      _mutating('/two-factor/verify-otp', {'code': code});

  // -- password / verification ----------------------------------------------

  Future<AuthResult<Object?>> requestPasswordReset({
    required String email,
    String? redirectTo,
    String? challengeToken,
  }) =>
      _transport.send('/request-password-reset',
          challengeToken: challengeToken,
          body: {
            'email': email,
            if (redirectTo != null) 'redirectTo': redirectTo,
          });

  Future<AuthResult<Object?>> resetPassword({
    required String token,
    required String newPassword,
  }) =>
      _transport.send('/reset-password', body: {
        'token': token,
        'newPassword': newPassword,
      });

  Future<AuthResult<Object?>> sendVerificationEmail({
    required String email,
    String? callbackURL,
    String? challengeToken,
  }) =>
      _transport.send('/send-verification-email',
          challengeToken: challengeToken,
          body: {
            'email': email,
            if (callbackURL != null) 'callbackURL': callbackURL,
          });

  // -- account ---------------------------------------------------------------

  Future<AuthResult<Object?>> updateProfile(Map<String, Object?> fields) =>
      _mutating('/update-user', fields);

  Future<AuthResult<Object?>> changePassword({
    required String currentPassword,
    required String newPassword,
    bool revokeOtherSessions = true,
  }) =>
      _mutating('/change-password', {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
        'revokeOtherSessions': revokeOtherSessions,
      });

  Future<AuthResult<Object?>> listSessions() =>
      _transport.send('/list-sessions', method: 'GET');

  /// Revoke one session by its id.
  ///
  /// The server takes a session ID, not a durable token - `listSessions()`
  /// exposes ids precisely because the token never leaves the cookie jar.
  Future<AuthResult<Object?>> revokeSession({required String sessionId}) =>
      _mutating('/revoke-session', {'sessionId': sessionId});

  // -- organizations ---------------------------------------------------------

  Future<AuthResult<Object?>> listOrganizations() =>
      _transport.send('/organization/list', method: 'GET');

  Future<AuthResult<Object?>> setActiveOrganization({String? organizationId}) =>
      _mutating('/organization/set-active', {'organizationId': organizationId});

  Future<AuthResult<Object?>> createOrganization({
    required String name,
    required String slug,
  }) =>
      _mutating('/organization/create', {'name': name, 'slug': slug});

  // -- session ---------------------------------------------------------------

  Future<AuthOwlSessionState> getSession({bool force = false}) =>
      session.refresh(force: force);

  /// Fetch the publishable project policy used by managed auth screens.
  Future<AuthResult<AuthOwlPublicConfig>> getPublicConfig() async {
    final result = await _transport.getPublicConfig();
    if (result.error != null) return AuthResult(error: result.error);
    final config = AuthOwlPublicConfig.fromJson(result.data);
    if (config == null) {
      return const AuthResult(
        error: AuthError(
          code: 'INVALID_PUBLIC_CONFIG',
          message:
              'The server returned an invalid public project configuration.',
        ),
      );
    }
    return AuthResult(data: config);
  }

  /// End the session server-side, then drop it locally.
  ///
  /// The local session is cleared even when the request fails: the user asked to
  /// be signed out, and leaving a usable cookie on the device because the
  /// network was down is the wrong way to fail.
  Future<AuthResult<Object?>> signOut() async {
    final result = await _transport.send('/sign-out', body: const {});
    await session.clear();
    return result;
  }

  /// Run an action, then re-read the session it may have changed.
  Future<AuthResult<Object?>> _mutating(String path, Map<String, Object?> body,
      {String? challengeToken}) async {
    final result =
        await _transport.send(path, body: body, challengeToken: challengeToken);
    if (result.isSuccess) await session.refresh(force: true);
    return result;
  }

  Future<void> dispose() async {
    await session.dispose();
    _transport.close();
  }
}
