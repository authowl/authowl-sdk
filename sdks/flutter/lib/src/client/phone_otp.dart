/// Provider-neutral phone OTP challenge contracts.
library;

/// Same ceiling enforced by the AuthOwl server and web SDK.
const int maxAkedlyShieldDifficulty = 12;

/// The anti-abuse ceremony selected by the AuthOwl server for phone OTP.
sealed class PhoneOtpChallenge {
  const PhoneOtpChallenge();

  /// Parse the bounded public challenge returned by AuthOwl.
  static PhoneOtpChallenge? fromJson(Object? value) {
    if (value is! Map) return null;
    if (value['kind'] == 'authowl_turnstile') {
      return const AuthOwlTurnstileChallenge();
    }
    if (value['kind'] != 'akedly_shield_v1_2') return null;

    final turnstile = value['turnstile'];
    final difficulty = value['difficulty'];
    if (turnstile is! Map ||
        value['connectionId'] is! String ||
        value['challenge'] is! String ||
        difficulty is! int ||
        difficulty < 0 ||
        difficulty > maxAkedlyShieldDifficulty ||
        value['challengeToken'] is! String ||
        value['challengeRequired'] is! bool ||
        turnstile['required'] is! bool ||
        (turnstile['siteKey'] != null && turnstile['siteKey'] is! String)) {
      return null;
    }

    return AkedlyShieldChallenge(
      connectionId: value['connectionId'] as String,
      challenge: value['challenge'] as String,
      difficulty: difficulty,
      challengeToken: value['challengeToken'] as String,
      challengeRequired: value['challengeRequired'] as bool,
      turnstileRequired: turnstile['required'] as bool,
      turnstileSiteKey: turnstile['siteKey'] as String?,
    );
  }
}

/// AuthOwl's standard Turnstile ceremony.
final class AuthOwlTurnstileChallenge extends PhoneOtpChallenge {
  const AuthOwlTurnstileChallenge();
}

/// An Akedly Shield V1.2 challenge.
///
/// Flutter does not solve this in Dart. Use the official Akedly SDK for the
/// target platform and pass the resulting values to [AkedlyShieldProof]. API
/// keys and pipeline IDs remain on the AuthOwl server.
final class AkedlyShieldChallenge extends PhoneOtpChallenge {
  const AkedlyShieldChallenge({
    required this.connectionId,
    required this.challenge,
    required this.difficulty,
    required this.challengeToken,
    required this.challengeRequired,
    required this.turnstileRequired,
    required this.turnstileSiteKey,
  });

  final String connectionId;
  final String challenge;
  final int difficulty;
  final String challengeToken;
  final bool challengeRequired;
  final bool turnstileRequired;
  final String? turnstileSiteKey;
}

/// Proof returned by the platform's official Akedly Shield SDK.
final class AkedlyShieldProof {
  AkedlyShieldProof({
    required this.connectionId,
    this.challengeToken,
    this.nonce,
    this.turnstileToken,
  }) {
    if ((challengeToken == null) != (nonce == null)) {
      throw ArgumentError(
        'challengeToken and nonce must either both be present or both be absent',
      );
    }
    if (nonce != null && nonce! < 0) {
      throw ArgumentError.value(nonce, 'nonce', 'must not be negative');
    }
  }

  final String connectionId;
  final String? challengeToken;
  final int? nonce;
  final String? turnstileToken;

  Map<String, Object?> toJson() => {
        'connectionId': connectionId,
        if (challengeToken != null) 'challengeToken': challengeToken,
        if (nonce != null) 'nonce': nonce,
        if (turnstileToken != null) 'turnstileToken': turnstileToken,
      };
}
