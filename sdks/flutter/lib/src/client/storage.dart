/// Where an AuthOwl client keeps its session.
library;

/// Persistent storage for the session cookie.
///
/// The session cookie is a bearer credential, so on a device this must be the
/// OS keychain (`flutter_secure_storage`), never `SharedPreferences`, which is
/// unencrypted files readable by anything inside the app sandbox.
///
/// Deliberately an interface with no default: silently falling back to memory
/// would make sign-in appear to work and then drop the session on the next app
/// launch, which is a confusing bug to chase.
abstract class AuthOwlStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// An in-memory store, for tests and previews where persistence is unwanted.
class InMemoryAuthOwlStorage implements AuthOwlStorage {
  final Map<String, String> _entries = {};

  @override
  Future<String?> read(String key) async => _entries[key];

  @override
  Future<void> write(String key, String value) async => _entries[key] = value;

  @override
  Future<void> delete(String key) async => _entries.remove(key);
}
