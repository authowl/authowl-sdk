/// Error types shared across the AuthOwl Flutter SDK.

/// Base class for every error this SDK throws.
abstract class AuthOwlException implements Exception {
  const AuthOwlException(this.message);

  final String message;

  @override
  String toString() => 'AuthOwlException: $message';
}

/// Why a publishable key could not be decoded.
enum PublishableKeyErrorReason {
  /// An empty key was supplied.
  missing,

  /// A `sk_` key reached a function that expects a publishable one.
  ///
  /// Its own reason, not a flavour of [malformed]: a leaked secret key
  /// compromises the whole project, so the fix is to rotate it rather than
  /// correct a typo.
  secretKey,

  /// The key did not match `pk_(live|test)_<uuid>_<base62>`.
  malformed,
}

/// A publishable key could not be decoded.
class PublishableKeyException extends AuthOwlException {
  const PublishableKeyException(super.message, this.reason);

  final PublishableKeyErrorReason reason;

  @override
  String toString() => 'PublishableKeyException: $message';
}
