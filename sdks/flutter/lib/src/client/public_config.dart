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

/// One immutable published notice exposed to a sign-up or privacy surface.
class AuthOwlPrivacyNotice {
  const AuthOwlPrivacyNotice({
    required this.noticeVersionId,
    required this.title,
    required this.body,
    required this.purposeCodes,
  });

  final String noticeVersionId;
  final Map<String, String> title;
  final Map<String, String> body;
  final Set<String> purposeCodes;
}

/// One active optional-consent purpose exposed by public config.
class AuthOwlConsentPurpose {
  const AuthOwlConsentPurpose({
    required this.purposeVersionId,
    required this.code,
    required this.title,
    required this.description,
  });

  final String purposeVersionId;
  final String code;
  final Map<String, String> title;
  final Map<String, String> description;
}

/// Published notices and optional purposes used by managed privacy surfaces.
class AuthOwlPrivacyConfig {
  const AuthOwlPrivacyConfig({
    required this.notices,
    required this.consentPurposes,
  });

  final List<AuthOwlPrivacyNotice> notices;
  final List<AuthOwlConsentPurpose> consentPurposes;

  /// Build the exact evidence body accepted by email sign-up.
  Map<String, Object?> buildSignUpEvidence({
    required String locale,
    required Set<String> grantedPurposeCodes,
    required String correlationId,
  }) =>
      <String, Object?>{
        'locale': locale,
        'correlationId': correlationId,
        'noticeVersionIds': notices
            .map((notice) => notice.noticeVersionId)
            .toList(growable: false),
        'consentDecisions': consentPurposes.expand((purpose) {
          final matching = notices.where(
            (notice) => notice.purposeCodes.contains(purpose.code),
          );
          if (matching.isEmpty) return const <Map<String, Object?>>[];
          return <Map<String, Object?>>[
            {
              'purposeCode': purpose.code,
              'purposeVersionId': purpose.purposeVersionId,
              'noticeVersionId': matching.first.noticeVersionId,
              'decision': grantedPurposeCodes.contains(purpose.code)
                  ? 'granted'
                  : 'refused',
              'guardianRequired': false,
              'guardianEvidenceId': null,
            }
          ];
        }).toList(growable: false),
      };
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
    this.privacy,
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
  final AuthOwlPrivacyConfig? privacy;

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

    AuthOwlPrivacyConfig? privacy;
    if (raw['privacy'] != null) {
      privacy = _privacyConfig(raw['privacy']);
      if (privacy == null) return null;
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
      privacy: privacy,
    );
  }
}

AuthOwlPrivacyConfig? _privacyConfig(Object? raw) {
  if (raw is! Map ||
      raw['notices'] is! List ||
      raw['consentPurposes'] is! List) {
    return null;
  }
  final notices = <AuthOwlPrivacyNotice>[];
  for (final entry in raw['notices'] as List) {
    if (entry is! Map) return null;
    final id = entry['noticeVersionId'];
    final title = _localized(entry['title']);
    final body = _localized(entry['body']);
    final purposeCodes = _stringSet(entry['purposeCodes']);
    if (id is! String ||
        id.isEmpty ||
        title == null ||
        body == null ||
        purposeCodes == null) {
      return null;
    }
    notices.add(AuthOwlPrivacyNotice(
      noticeVersionId: id,
      title: title,
      body: body,
      purposeCodes: purposeCodes,
    ));
  }
  final purposes = <AuthOwlConsentPurpose>[];
  for (final entry in raw['consentPurposes'] as List) {
    if (entry is! Map) return null;
    final id = entry['purposeVersionId'];
    final code = entry['code'];
    final title = _localized(entry['title']);
    final description = _localized(entry['description']);
    if (id is! String ||
        id.isEmpty ||
        code is! String ||
        code.isEmpty ||
        title == null ||
        description == null) {
      return null;
    }
    purposes.add(AuthOwlConsentPurpose(
      purposeVersionId: id,
      code: code,
      title: title,
      description: description,
    ));
  }
  return AuthOwlPrivacyConfig(notices: notices, consentPurposes: purposes);
}

Map<String, String>? _localized(Object? raw) {
  if (raw is! Map || raw['en'] is! String || raw['ar'] is! String) return null;
  return <String, String>{'en': raw['en'] as String, 'ar': raw['ar'] as String};
}

Set<String>? _stringSet(Object? raw) {
  if (raw is! List || raw.any((value) => value is! String)) return null;
  return raw.cast<String>().toSet();
}
