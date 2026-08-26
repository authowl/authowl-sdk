/// AuthOwl headless client SDK for Flutter apps.
///
/// This entrypoint exposes the client and session layer without importing
/// widgets. Most applications should import `authowl.dart`, which re-exports
/// this API together with the managed Flutter UI.
///
/// ```dart
/// final auth = AuthOwlClient(
///   publishableKey: 'pk_live_…',
///   apiUrl: 'https://api.authowl.dev',
///   storage: mySecureStorage,   // flutter_secure_storage in an app
/// );
///
/// await auth.getSession();
/// auth.session.changes.listen((state) => setState(() {}));
///
/// final result = await auth.signInWithEmail(email: e, password: p);
/// if (!result.isSuccess) showError(result.error!.message);
/// ```
///
/// Social sign-in takes an ID token from the provider's native SDK. Redirect
/// OAuth is unsupported on purpose - it completes inside a system browser whose
/// cookie jar this client cannot read, so the session would land somewhere the
/// app can never see it.
///
/// The paths this calls are pinned by `conformance/client-surface.json`, derived
/// from `@authowl/core` and drift-checked in CI.
library;

export 'src/client/auth_client.dart';
export 'src/client/phone_otp.dart';
export 'src/client/projection.dart' show projectAuthPayload;
export 'src/client/public_config.dart';
export 'src/client/session.dart';
export 'src/client/storage.dart';
export 'src/client/transport.dart'
    show
        AuthError,
        AuthOwlTransport,
        AuthResult,
        authChallengeHeader,
        maxResponseBytes,
        readSetCookie,
        requestTimeout;
export 'src/errors.dart';
export 'src/membership.dart';
export 'src/publishable_key.dart';
