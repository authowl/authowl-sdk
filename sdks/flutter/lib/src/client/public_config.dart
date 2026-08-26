/// Publishable project policy for native authentication screens.
library;

/// Legal-consent policy for account creation.
class AuthOwlLegalConfig {
  const AuthOwlLegalConfig({
    required this.required,
    required this.version,
    this.termsUrl,
    this.privacyUrl,
  });

  final bool required;
  final int version;
  final String? termsUrl;
  final String? privacyUrl;
}

/// Provider-neutral bot-challenge configuration exposed to an application.
class AuthOwlCaptchaConfig {
  const AuthOwlCaptchaConfig({required this.provider, required this.siteKey});

  /// Provider slug. New server providers remain visible to older SDKs.
  final String provider;

  /// Public widget key for the configured provider.
  final String siteKey;
}

/// The public capabilities needed by Flutter clients.
class AuthOwlPublicConfig {
  const AuthOwlPublicConfig({
    required this.enabledMethods,
    required this.passwordSignUp,
    required this.passwordSignIn,
    required this.passwordMinLength,
    required this.passwordMaxLength,
    required this.legal,
    required this.organizations,
    required this.locale,
    required this.captcha,
    this.primaryColor,
  });

  final Set<String> enabledMethods;
  final bool passwordSignUp;
  final bool passwordSignIn;
  final int passwordMinLength;
  final int passwordMaxLength;
  final AuthOwlLegalConfig legal;
  final bool organizations;
  final String locale;
  final AuthOwlCaptchaConfig? captcha;
  final String? primaryColor;

  /// Decode the server's current shape while preserving the legacy method list.
  static AuthOwlPublicConfig? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final methodsRaw = raw['enabledMethods'];
    final legalRaw = raw['legal'];
    final brandingRaw = raw['branding'];
    if (methodsRaw is! List || legalRaw is! Map) return null;
    final methods = methodsRaw.whereType<String>().toSet();
    if (methods.length != methodsRaw.length) return null;

    final authentication = raw['authentication'];
    final auth = authentication is Map ? authentication : null;
    final emailRaw = auth?['email'];
    final passwordRaw = auth?['password'];
    final email = emailRaw is Map ? emailRaw : null;
    final password = passwordRaw is Map ? passwordRaw : null;
    final signInRaw = email?['signIn'];
    final signIn =
        signInRaw is List ? signInRaw.whereType<String>().toSet() : methods;

    final minLength =
        password?['minLength'] is int ? password!['minLength'] as int : 8;
    final maxLength =
        password?['maxLength'] is int ? password!['maxLength'] as int : 128;
    final legalVersion = legalRaw['version'];
    final legalRequired = legalRaw['required'];
    if (minLength < 1 ||
        maxLength < minLength ||
        legalVersion is! int ||
        legalVersion < 0 ||
        legalRequired is! bool) {
      return null;
    }

    final captchaRaw = raw['captcha'];
    final legacySiteKey = raw['authTurnstileSiteKey'];
    AuthOwlCaptchaConfig? captcha;
    if (captchaRaw != null) {
      if (captchaRaw is! Map) return null;
      final provider = captchaRaw['provider'];
      final siteKey = captchaRaw['siteKey'];
      if (provider is! String ||
          provider.isEmpty ||
          provider.length > 64 ||
          siteKey is! String ||
          siteKey.isEmpty ||
          siteKey.length > 512) {
        return null;
      }
      captcha = AuthOwlCaptchaConfig(provider: provider, siteKey: siteKey);
    } else if (legacySiteKey is String) {
      if (legacySiteKey.isEmpty || legacySiteKey.length > 512) return null;
      captcha =
          AuthOwlCaptchaConfig(provider: 'turnstile', siteKey: legacySiteKey);
    }

    return AuthOwlPublicConfig(
      enabledMethods: methods,
      passwordSignUp: password?['signUp'] is bool
          ? password!['signUp'] as bool
          : methods.contains('password'),
      passwordSignIn: signIn.contains('password'),
      passwordMinLength: minLength,
      passwordMaxLength: maxLength,
      legal: AuthOwlLegalConfig(
        required: legalRequired,
        version: legalVersion,
        termsUrl: legalRaw['termsUrl'] is String
            ? legalRaw['termsUrl'] as String
            : null,
        privacyUrl: legalRaw['privacyUrl'] is String
            ? legalRaw['privacyUrl'] as String
            : null,
      ),
      organizations: raw['organizations'] == true,
      locale: raw['locale'] is String ? raw['locale'] as String : 'en',
      captcha: captcha,
      primaryColor: brandingRaw is Map && brandingRaw['primaryColor'] is String
          ? brandingRaw['primaryColor'] as String
          : null,
    );
  }
}
