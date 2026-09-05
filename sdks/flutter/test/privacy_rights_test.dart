import 'package:authowl/authowl.dart';
import 'package:flutter_test/flutter_test.dart';

AuthOwlPublicConfig _parse(Map<String, Object?> privacy) => AuthOwlPublicConfig.fromJson(
      <String, Object?>{
        'enabledMethods': <Object?>['password'],
        'legal': <String, Object?>{'version': 0, 'required': false},
        'privacy': privacy,
      },
    )!;

AuthOwlPrivacyConfig _config(Object? availableRightTypes) => _parse(<String, Object?>{
      'notices': <Object?>[],
      'consentPurposes': <Object?>[],
      'availableRightTypes': availableRightTypes,
    }).privacy!;

void main() {
  group('advertised data rights', () {
    test('offers every right when the server does not report the field', () {
      // The compatibility rule: a server released before this field simply
      // omits it, and reading that as "none" would blank the rights section
      // for every project on an older deployment.
      final config = _parse(<String, Object?>{
        'notices': <Object?>[],
        'consentPurposes': <Object?>[],
      });
      expect(offeredRightsFor(config.privacy), AuthOwlPrivacyRight.values);
    });

    test('offers none when the project accepts none', () {
      // Distinct from absent. This is the state behind the live report: an
      // unapproved compliance profile refuses every right.
      expect(offeredRightsFor(_config(<Object?>[])), isEmpty);
    });

    test('offers exactly what is advertised', () {
      final offered = offeredRightsFor(_config(<Object?>['access', 'portability']));
      expect(offered, <AuthOwlPrivacyRight>[
        AuthOwlPrivacyRight.access,
        AuthOwlPrivacyRight.portability,
      ]);
    });

    test('ignores a right this build cannot render', () {
      final offered = offeredRightsFor(_config(<Object?>['access', 'telepathy']));
      expect(offered, <AuthOwlPrivacyRight>[AuthOwlPrivacyRight.access]);
    });

    test('a malformed notice cannot re-open rights the server refused', () {
      // This was a fail-OPEN: one bad notice discarded the whole privacy block,
      // null read as "the server cannot say", and a project that had refused
      // every right got all seven buttons back - each answering 409.
      final config = _parse(<String, Object?>{
        'notices': <Object?>['not a notice'],
        'consentPurposes': <Object?>[],
        'availableRightTypes': <Object?>[],
      });

      expect(offeredRightsFor(config.privacy), isEmpty);
    });

    test('treats a malformed value as absent, never as "offer none"', () {
      // `whereType<String>()` silently turned a list of non-strings into an
      // empty list, which HIDES every right - the opposite of the documented
      // rule, and a worse failure than offering one the server declines.
      for (final malformed in <Object?>['access', 42, <Object?>[1, 2], <Object?>[<String, Object?>{}]]) {
        expect(
          offeredRightsFor(_config(malformed)),
          AuthOwlPrivacyRight.values,
          reason: 'malformed value $malformed must read as absent',
        );
      }
    });
  });
}
