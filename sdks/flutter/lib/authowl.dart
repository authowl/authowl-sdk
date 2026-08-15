/// AuthOwl for Flutter: provider, widgets, and localized auth screens.
///
/// ```dart
/// AuthOwlProvider(
///   publishableKey: 'pk_live_…',
///   apiUrl: 'https://api.authowl.dev',
///   storage: myKeychainStorage,   // flutter_secure_storage in production
///   child: const AuthOwlSignIn(),
/// )
/// ```
///
/// The strings come from `lib/src/i18n/catalog.g.dart`, generated from
/// `@authowl/core` so the wording matches the web and React Native SDKs
/// exactly. CI fails if it drifts.
///
/// Social sign-in and passkeys use the provider's own native SDK through the
/// package's headless client; redirect OAuth is unsupported because it finishes
/// inside a system browser whose cookie jar this client cannot read.
library;

export 'authowl_client.dart';

export 'src/i18n/messages.dart'
    show fallbackLocale, formatMessage, hasCatalog, isRightToLeft;
export 'src/provider.dart' show AuthOwlProvider, AuthOwlScope;
export 'src/theme.dart' show authOwlBrandColor, authOwlBrandForeground;
export 'src/widgets/email_otp_form.dart';
export 'src/widgets/primitives.dart';
export 'src/widgets/sign_in.dart';
export 'src/widgets/sign_up.dart';
