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
      primaryColor: brandingRaw is Map && brandingRaw['primaryColor'] is String
          ? brandingRaw['primaryColor'] as String
          : null,
    );
  }
}
