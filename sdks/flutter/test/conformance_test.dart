/// The shared corpus, re-verified in Dart.
///
/// `conformance/vectors/` is the single source of truth for the primitives every
/// AuthOwl SDK must implement identically. The other five SDKs already load
/// these files; this package implements two of the primitives but was not
/// re-verifying either, so a Dart-only divergence could not be caught by CI -
/// which is how the project-id case defect reached this SDK independently of the
/// TypeScript one.
///
/// Covers the vectors this package has an implementation for. `jwt-verify`,
/// `jwks-parse` and `webhook-verify` are server-side primitives this client SDK
/// does not implement; `membership-has` is implemented here and remains
/// uncovered, which is a known remaining gap rather than a statement that it
/// agrees.
library;

import 'dart:convert';
import 'dart:io';

import 'package:authowl/authowl.dart';
import 'package:authowl/src/cookie.dart';
import 'package:test/test.dart';

Map<String, Object?> _vectors(String name) =>
    jsonDecode(File('../../conformance/vectors/$name').readAsStringSync())
        as Map<String, Object?>;

void main() {
  group('conformance: session cookie name', () {
    final cases = (_vectors('cookie-name.json')['cases']! as List)
        .cast<Map<String, Object?>>();

    for (final testCase in cases) {
      test(testCase['name'] as String, () {
        // `secure` is absent in the vector that pins the default, so it is read
        // as "absent means call without the argument", not "absent means false":
        // defaulting here would let a wrong default pass.
        final secure = testCase['secure'] as bool?;
        final projectId = testCase['projectId']! as String;
        final actual = secure == null
            ? sessionCookieName(projectId)
            : sessionCookieName(projectId, secure: secure);
        expect(actual, testCase['expect']! as String);
      });
    }
  });

  group('conformance: publishable key decoding', () {
    final cases = (_vectors('publishable-key.json')['cases']! as List)
        .cast<Map<String, Object?>>();

    const reasons = {
      'missing': PublishableKeyErrorReason.missing,
      'secret_key': PublishableKeyErrorReason.secretKey,
      'malformed': PublishableKeyErrorReason.malformed,
    };

    for (final testCase in cases) {
      test(testCase['name'] as String, () {
        final expected = testCase['expect']! as Map<String, Object?>;
        final key = testCase['key']! as String;

        if (expected['ok'] == true) {
          final decoded = decodePublishableKey(key);
          expect(decoded.prefix, expected['prefix']);
          expect(decoded.env.name, expected['env']);
          expect(decoded.projectId, expected['projectId']);
          return;
        }

        // The reason is asserted, not just the throw: the corpus treats `sk_`
        // as its own outcome rather than a flavour of "malformed", because the
        // fix for a leaked secret key is to rotate it, not correct a typo.
        expect(
          () => decodePublishableKey(key),
          throwsA(isA<PublishableKeyException>().having(
            (e) => e.reason,
            'reason',
            reasons[expected['reason']],
          )),
        );
      });
    }
  });
}
