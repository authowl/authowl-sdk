/// Holds the Flutter client to the shared client-surface contract.
///
/// `conformance/client-surface.json` is derived from `@authowl/core`, and CI
/// fails when it drifts from that TypeScript. That guards one direction only:
/// it proves the ARTIFACT matches the server surface, not that THIS client
/// does. Without the check below, renaming an endpoint would regenerate the
/// artifact, pass CI, and leave the Flutter client calling a route that no longer
/// exists - a silent break that only shows up as sign-in failing in production.
///
/// So this reads the endpoints the client actually calls out of its own source
/// and asserts each one against the contract: present, same method, and not a
/// browser-only route a native app can never complete.
library;

import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

/// One endpoint the Flutter client calls.
typedef ClientCall = ({String path, String method});

/// `_transport.send('/x', method: 'GET')` or `_mutating('/x', {…})`.
final _call = RegExp(
  r"""(?:_transport\.send|_mutating)\(\s*'(/[a-zA-Z0-9/_-]+)'([^;]{0,200})""",
);
final _explicitMethod = RegExp(r"""method:\s*'([A-Z]+)'""");

/// Every module that issues a request. The session store calls `/get-session`
/// itself, so reading only the action client would leave that route unguarded.
const _clientSources = [
  'lib/src/client/auth_client.dart',
  'lib/src/client/session.dart',
];

Set<ClientCall> callsInClientSource() {
  final source =
      _clientSources.map((file) => File(file).readAsStringSync()).join('\n');
  return {
    for (final match in _call.allMatches(source))
      (
        path: match.group(1)!,
        // `_mutating` always posts; `send` defaults to POST unless it names a
        // method. Mirrors the defaults in transport.dart and auth_client.dart.
        method: _explicitMethod.firstMatch(match.group(2) ?? '')?.group(1) ??
            'POST',
      ),
  };
}

void main() {
  final contract = jsonDecode(
    File('../../conformance/client-surface.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final operations =
      (contract['operations']! as List).cast<Map<String, Object?>>();
  final byPath = {for (final op in operations) op['path'] as String: op};

  final calls = callsInClientSource();

  test('the client calls at least the core sign-in surface', () {
    // Guards the extractor itself: a regex that silently matched nothing would
    // make every assertion below vacuously pass.
    expect(calls.length, greaterThan(15));
    expect(
      calls.map((call) => call.path),
      containsAll(<String>[
        '/sign-in/email',
        '/sign-up/email',
        '/sign-out',
        '/get-session'
      ]),
    );
  });

  test('every endpoint the client calls exists in the contract', () {
    final unknown =
        calls.where((call) => !byPath.containsKey(call.path)).toList();
    expect(
      unknown,
      isEmpty,
      reason: 'These paths are not in conformance/client-surface.json, so the '
          'client is calling routes @authowl/core does not: $unknown',
    );
  });

  test('every endpoint uses the method the contract declares', () {
    final mismatched = <String>[];
    for (final call in calls) {
      final declared = byPath[call.path]?['method'] as String?;
      if (declared != null && declared != call.method) {
        mismatched
            .add('${call.path}: client=${call.method} contract=$declared');
      }
    }
    expect(mismatched, isEmpty, reason: mismatched.join('\n'));
  });

  test('no browser-only endpoint is reachable from a native client', () {
    // WebAuthn ceremonies and redirect SSO finish inside a browser whose cookie
    // jar this client cannot read. Calling one would appear to succeed and
    // leave the user signed out.
    final browserOnly = calls
        .where((call) => byPath[call.path]?['native'] == false)
        .map((call) => call.path)
        .toList();
    expect(browserOnly, isEmpty, reason: 'browser-only: $browserOnly');
  });
}
