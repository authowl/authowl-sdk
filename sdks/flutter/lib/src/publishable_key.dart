/// AuthOwl publishable-key decoding.
library;

import 'errors.dart';

final RegExp _publishableKey =
    RegExp(r'^(pk_(live|test))_([0-9a-fA-F-]{36})_([A-Za-z0-9]{20,})$');
final RegExp _secretKey = RegExp(r'^sk_', caseSensitive: false);

/// The deployment a publishable key belongs to.
enum AuthOwlEnvironment { live, test }

/// The decoded form of a `pk_live_…` / `pk_test_…` key.
class PublishableKey {
  const PublishableKey({
    required this.prefix,
    required this.env,
    required this.projectId,
  });

  final String prefix;
  final AuthOwlEnvironment env;
  final String projectId;
}

/// Validate a publishable key and extract its project id.
///
/// Throws [PublishableKeyException] with [PublishableKeyErrorReason.secretKey]
/// for anything starting `sk_`. That check runs FIRST, before any shape
/// validation: a secret key must never be reported as merely "malformed",
/// because the fix is to rotate it, not correct a typo.
PublishableKey decodePublishableKey(String key) {
  if (key.isEmpty) {
    throw const PublishableKeyException(
      'publishableKey is required',
      PublishableKeyErrorReason.missing,
    );
  }
  if (_secretKey.hasMatch(key)) {
    throw const PublishableKeyException(
      'A secret key was passed where a publishable key was expected. '
      'Never embed secret keys in client code.',
      PublishableKeyErrorReason.secretKey,
    );
  }
  final match = _publishableKey.firstMatch(key);
  if (match == null) {
    throw const PublishableKeyException(
      'publishableKey is malformed; expected pk_(live|test)_<uuid>_<base62>',
      PublishableKeyErrorReason.malformed,
    );
  }
  return PublishableKey(
    prefix: match.group(1)!.toLowerCase(),
    env: match.group(2)!.toLowerCase() == 'live'
        ? AuthOwlEnvironment.live
        : AuthOwlEnvironment.test,
    // Lowercased for the same reason prefix and env are: the pattern accepts
    // `[0-9a-fA-F-]`, so an upper-case uuid is a VALID key, and returning it
    // verbatim yields an id that never matches the lowercase Postgres `uuid` the
    // server sends back or names its cookie after.
    projectId: match.group(3)!.toLowerCase(),
  );
}
