# AuthOwl for Flutter

**[Complete Flutter guide](https://authowl.dev/docs/sdks/flutter)**

Flutter widgets, provider, and session management for
[AuthOwl](https://authowl.dev).

```yaml
dependencies:
  authowl: ^0.1.0
  flutter_secure_storage: ^9.0.0
```

Import the provider, managed authentication screens, and headless client from
one canonical entrypoint:

```dart
import 'package:authowl/authowl.dart';
```

## Setup

```dart
AuthOwlProvider(
  publishableKey: const String.fromEnvironment('AUTHOWL_PUBLISHABLE_KEY'),
  apiUrl: 'https://api.authowl.dev',
  storage: keychainStorage,     // see below
  child: const MyApp(),
)
```

Built-in controls use AuthOwl gold (`#F5B84C`) by default. The project's
dashboard color replaces it automatically. An app-level override has highest
priority when needed:

```dart
AuthOwlProvider(
  primaryColor: const Color(0xff0ea5a4),
  // ...publishableKey, apiUrl, storage, and child
)
```

The session cookie is a bearer credential - anything holding it *is* the
signed-in user until it expires - so it belongs in the OS keychain, never in
`SharedPreferences`, which is unencrypted:

```dart
class KeychainStorage implements AuthOwlStorage {
  final _store = const FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _store.read(key: key);
  @override
  Future<void> write(String key, String value) => _store.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _store.delete(key: key);
}
```

A `pk_live_…` key against a plain-`http` origin is refused outright: passwords
and the session cookie would travel in the clear. Loopback `http` works with a
`pk_test_…` key for local development.

## Widgets

```dart
AuthOwlSignIn(
  onSignedIn: () => context.go('/home'),
  onSecondFactorRequired: () => context.go('/mfa'),
  onMfaEnrollmentRequired: () => context.go('/mfa/enrol'),
)

AuthOwlSignUp(onSignedUp: ({required sessionCreated}) =>
  context.go(sessionCreated ? '/home' : '/check-your-email'))

AuthOwlEmailOtpForm(onSignedIn: () => context.go('/home'))
```

`AuthOwlSignIn` reports success **only once a session exists**. A two-factor
challenge calls `onSecondFactorRequired`; a session held at mandatory MFA
enrolment calls `onMfaEnrollmentRequired`. Neither path calls `onSignedIn`.

`AuthOwlSignUp` reports whether a session was created. Projects requiring email
verification create none.

The provider loads the project's public configuration once. Built-in widgets
hide disabled methods, enforce the configured password length, collect required
legal consent, and send the accepted consent version automatically.

## Session state

```dart
final scope = AuthOwlProvider.of(context);
if (scope.session.isSignedIn) {
  Text('Hi, ${scope.session.user!.email}');
}
```

A session held at required-MFA enrolment is deliberately **not** signed in -
treating it as authenticated would let an app skip the enrolment gate.

## Localization

```dart
AuthOwlProvider(locale: 'ar', ...)
```

Strings come from `lib/src/i18n/catalog.g.dart`, **generated from
`@authowl/core`** so the wording matches the web and React Native SDKs exactly.
CI fails if it drifts. It is not auto-detected from the device: a phone set to
Arabic does not mean the app is localized, and switching only the auth screens
is worse than defaulting.
The provider also applies the matching right-to-left text direction to its
subtree.

To regenerate after changing the shared catalogs:

```bash
pnpm --filter @authowl/core run build && node scripts/generate-dart-i18n.mjs
```

## Social sign-in and passkeys

Use the headless client with your provider's native SDK:

```dart
final result = await scope.client.signInWithIdToken(
  provider: 'google',
  idToken: googleCredential.idToken!,
);
```

Redirect OAuth is unsupported on purpose - it completes inside a system browser
whose cookie jar this client cannot read, so the session would land somewhere
the app can never see it.

For phone OTP, call `preparePhoneOtp()` before sending. The server returns the
provider-neutral anti-abuse ceremony. Standard routes use
`AuthOwlTurnstileChallenge`; Akedly Shield routes return an
`AkedlyShieldChallenge`. Solve Shield with Akedly's official SDK for the target
platform, then pass an `AkedlyShieldProof` to `startPhoneOtp()`. Provider API
keys and pipeline IDs never enter the Flutter application.

## Conformance

```bash
flutter test
```

Re-verifies this package's share of the corpus in `conformance/vectors` -
`cookie-name.json` and `publishable-key.json`, the two primitives a client SDK
implements - alongside the widget suite. If a case fails, this implementation has
diverged from the contract: the fix belongs in the code, not the vector. See
`conformance/README.md`.

## License

MIT
