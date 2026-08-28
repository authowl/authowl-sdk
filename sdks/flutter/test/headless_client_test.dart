/// Tests for the parts of the client that the shared corpus cannot cover:
/// the session cookie jar, the transport's safety bounds, and session state.
library;

import 'dart:convert';

import 'package:authowl/authowl.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

const projectId = '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60';
const publishableKey = 'pk_live_${projectId}_A1b2C3d4E5f6G7h8I9j0';
final secureCookie =
    '__Secure-p_${projectId.replaceAll('-', '')}.session_token';

/// Records every request and replies with a scripted response.
class Recorder {
  final List<http.Request> requests = [];
  late final MockClient client;

  Recorder(http.Response Function(http.Request) respond) {
    client = MockClient((request) async {
      requests.add(request);
      return respond(request);
    });
  }
}

class TrackingClient extends http.BaseClient {
  bool closed = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(const Stream<List<int>>.empty(), 200);

  @override
  void close() {
    closed = true;
    super.close();
  }
}

AuthOwlTransport transportWith(
  Recorder recorder,
  AuthOwlStorage storage, {
  String apiUrl = 'https://api.authowl.dev',
  bool allowHttpLoopback = false,
}) =>
    AuthOwlTransport(
      apiUrl: apiUrl,
      publishableKey: publishableKey,
      projectId: projectId,
      storage: storage,
      allowHttpLoopback: allowHttpLoopback,
      httpClient: recorder.client,
    );

void main() {
  _challengeTokenTests();
  group('readSetCookie', () {
    test('reads the named cookie and drops its attributes', () {
      expect(
        readSetCookie(
            ['$secureCookie=abc123; Path=/; HttpOnly; Secure'], secureCookie),
        'abc123',
      );
    });

    test('is not fooled by an Expires attribute containing a comma', () {
      expect(
        readSetCookie(
          [
            '$secureCookie=abc123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/'
          ],
          secureCookie,
        ),
        'abc123',
      );
    });

    test('finds the session cookie behind another Set-Cookie header', () {
      // The regression this list signature exists for: joining these into one
      // string and splitting on commas is ambiguous, because the first value
      // legitimately contains commas in its Expires attribute.
      expect(
        readSetCookie(
          [
            'csrf=zzz; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
            '$secureCookie=abc123; Path=/; HttpOnly',
          ],
          secureCookie,
        ),
        'abc123',
      );
    });

    test('reports a cleared cookie as empty, not absent', () {
      expect(readSetCookie(['$secureCookie=; Max-Age=0'], secureCookie), '');
    });

    test('ignores a different cookie', () {
      expect(readSetCookie(['other=abc; Path=/'], secureCookie), isNull);
    });

    test('returns null when no cookies were set at all', () {
      expect(readSetCookie(const [], secureCookie), isNull);
    });
  });

  group('origin policy', () {
    test('refuses a plain-http production origin', () {
      // Otherwise this would merely pick the unprefixed cookie name and go on
      // sending passwords and the session cookie in the clear.
      expect(
        () => AuthOwlClient(
          publishableKey: publishableKey,
          apiUrl: 'http://api.example.com',
          storage: InMemoryAuthOwlStorage(),
        ),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('refuses plain http on loopback for a live key', () {
      expect(
        () => AuthOwlTransport(
          apiUrl: 'http://localhost:3000',
          publishableKey: publishableKey,
          projectId: projectId,
          storage: InMemoryAuthOwlStorage(),
        ),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('allows loopback http when the caller opts in', () {
      expect(
        AuthOwlTransport(
          apiUrl: 'http://localhost:3000',
          publishableKey: publishableKey,
          projectId: projectId,
          storage: InMemoryAuthOwlStorage(),
          allowHttpLoopback: true,
        ),
        isNotNull,
      );
    });
  });

  group('session cookie jar', () {
    test('sends no cookie before one has been stored', () async {
      final recorder = Recorder((_) => http.Response('{}', 200));
      await transportWith(recorder, InMemoryAuthOwlStorage())
          .send('/get-session', method: 'GET');
      expect(recorder.requests.single.headers['cookie'], isNull);
    });

    test('captures the session cookie the server sets', () async {
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((_) => http.Response('{}', 200, headers: {
            'set-cookie': '$secureCookie=tok_1; Path=/; HttpOnly',
          }));
      final transport = transportWith(recorder, storage);

      await transport.send('/sign-in/email', body: const {});
      expect(await storage.read(transport.storageKey), 'tok_1');
    });

    test('replays a stored cookie and always sends the publishable key',
        () async {
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((_) => http.Response('{}', 200));
      final transport = transportWith(recorder, storage);
      await storage.write(transport.storageKey, 'tok_1');

      await transport.send('/get-session', method: 'GET');
      final request = recorder.requests.single;
      expect(request.headers['cookie'], '$secureCookie=tok_1');
      expect(request.headers['x-publishable-key'], publishableKey);
    });

    test('forgets the session when the server clears the cookie', () async {
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((_) => http.Response('{}', 200, headers: {
            'set-cookie': '$secureCookie=; Max-Age=0; Path=/',
          }));
      final transport = transportWith(recorder, storage);
      await storage.write(transport.storageKey, 'tok_1');

      await transport.send('/sign-out', body: const {});
      expect(await storage.read(transport.storageKey), isNull);
    });

    test('uses the unprefixed cookie name against an insecure origin',
        () async {
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((_) => http.Response('{}', 200));
      final transport = transportWith(
        recorder,
        storage,
        apiUrl: 'http://localhost:3000',
        allowHttpLoopback: true,
      );
      await storage.write(transport.storageKey, 'tok_1');

      await transport.send('/get-session', method: 'GET');
      expect(
        recorder.requests.single.headers['cookie'],
        'p_${projectId.replaceAll('-', '')}.session_token=tok_1',
      );
    });
  });

  group('transport safety', () {
    test('never surfaces the durable session token to callers', () async {
      final recorder = Recorder((_) => http.Response(
            jsonEncode({
              'user': {'id': 'user_1'},
              'token': 'durable-secret'
            }),
            200,
          ));
      final result = await transportWith(recorder, InMemoryAuthOwlStorage())
          .send('/sign-in/email', body: const {});

      expect((result.data! as Map).containsKey('token'), isFalse);
      expect((result.data! as Map)['user'], {'id': 'user_1'});
    });

    test('refuses to follow redirects', () async {
      final recorder = Recorder((_) => http.Response('{}', 200));
      await transportWith(recorder, InMemoryAuthOwlStorage())
          .send('/get-session', method: 'GET');
      expect(recorder.requests.single.followRedirects, isFalse);
    });

    test('maps a problem response to a typed error', () async {
      final recorder = Recorder((_) => http.Response(
            jsonEncode(
                {'code': 'RATE_LIMITED', 'message': 'Too many attempts.'}),
            429,
          ));
      final result = await transportWith(recorder, InMemoryAuthOwlStorage())
          .send('/sign-in/email', body: const {});

      expect(result.isSuccess, isFalse);
      expect(result.error!.code, 'RATE_LIMITED');
      expect(result.error!.status, 429);
    });

    test('refuses an oversized response instead of buffering it', () async {
      // The ceiling has to bite DURING the read. A check performed after the
      // whole body is buffered is not a ceiling at all - the memory is already
      // committed by the time the length is known.
      final oversized = 'x' * (maxResponseBytes + 1024);
      final recorder = Recorder((_) => http.Response(oversized, 200));
      final result = await transportWith(recorder, InMemoryAuthOwlStorage())
          .send('/get-session', method: 'GET');

      expect(result.isSuccess, isFalse);
      expect(result.error!.code, 'RESPONSE_TOO_LARGE');
    });

    test('accepts a response that sits just under the ceiling', () async {
      final body = jsonEncode({'padding': 'y' * (maxResponseBytes ~/ 2)});
      final recorder = Recorder((_) => http.Response(body, 200));
      final result = await transportWith(recorder, InMemoryAuthOwlStorage())
          .send('/get-session', method: 'GET');

      expect(result.isSuccess, isTrue);
    });

    test('reports invalid JSON rather than throwing', () async {
      final recorder = Recorder((_) => http.Response('not json', 200));
      final result = await transportWith(recorder, InMemoryAuthOwlStorage())
          .send('/get-session', method: 'GET');
      expect(result.error!.code, 'INVALID_RESPONSE');
    });
  });

  group('session store', () {
    test('reports signed out without a request when no cookie is held',
        () async {
      final recorder = Recorder((_) => http.Response('{}', 200));
      final store = AuthOwlSessionStore(
          transportWith(recorder, InMemoryAuthOwlStorage()));

      final state = await store.refresh();
      expect(state.isSignedIn, isFalse);
      expect(recorder.requests, isEmpty);
      await store.dispose();
    });

    test('publishes the signed-in user and strips the nested session token',
        () async {
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((_) => http.Response(
            jsonEncode({
              'user': {'id': 'user_1', 'email': 'mona@example.test'},
              'session': {'id': 'session_1', 'token': 'durable-secret'},
            }),
            200,
          ));
      final transport = transportWith(recorder, storage);
      await storage.write(transport.storageKey, 'tok_1');
      final store = AuthOwlSessionStore(transport);

      final state = await store.refresh();
      expect(state.isSignedIn, isTrue);
      expect(state.user!.email, 'mona@example.test');
      expect(state.session!.id, 'session_1');
      await store.dispose();
    });

    test('bypasses the server cookie cache on a forced refresh', () async {
      // A forced refresh follows an action that may have changed the session.
      // Without disableCookieCache the server may answer from its cookie cache
      // and hand back the pre-change snapshot - the stale-MFA repair path.
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((_) => http.Response(
            jsonEncode({
              'user': {'id': 'user_1'},
              'session': {'id': 'session_1'}
            }),
            200,
          ));
      final transport = transportWith(recorder, storage);
      await storage.write(transport.storageKey, 'tok_1');
      final store = AuthOwlSessionStore(transport);

      await store.refresh(force: true);
      expect(recorder.requests.single.url.queryParameters['disableCookieCache'],
          'true');

      await store.refresh();
      expect(recorder.requests.last.url.queryParameters, isEmpty);
      await store.dispose();
    });

    test('treats a session pending MFA enrolment as NOT signed in', () async {
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((_) => http.Response(
            jsonEncode({
              'user': {'id': 'user_1'},
              'session': {'id': 'session_1', 'pendingMfaEnrollment': true},
            }),
            200,
          ));
      final transport = transportWith(recorder, storage);
      await storage.write(transport.storageKey, 'tok_1');
      final store = AuthOwlSessionStore(transport);

      final state = await store.refresh();
      // The user exists, but the project holds them at enrolment. Treating this
      // as signed in would let an app skip the gate entirely.
      expect(state.session!.pendingMfaEnrollment, isTrue);
      expect(state.isSignedIn, isFalse);
      await store.dispose();
    });
  });

  group('AuthOwlClient', () {
    test('refuses a secret key instead of shipping it in an app binary', () {
      expect(
        () => AuthOwlClient(
          publishableKey: 'sk_live_${projectId}_A1b2C3d4E5f6G7h8I9j0',
          apiUrl: 'https://api.authowl.dev',
          storage: InMemoryAuthOwlStorage(),
        ),
        throwsA(isA<PublishableKeyException>()),
      );
    });

    test('does not close an HTTP client owned by the caller', () async {
      final httpClient = TrackingClient();
      final client = AuthOwlClient(
        publishableKey: publishableKey,
        apiUrl: 'https://api.authowl.dev',
        storage: InMemoryAuthOwlStorage(),
        httpClient: httpClient,
      );

      await client.dispose();

      expect(httpClient.closed, isFalse);
    });

    test('loads typed public config without replaying the session', () async {
      final storage = InMemoryAuthOwlStorage();
      await storage.write('authowl.session.$projectId', 'tok_1');
      final recorder = Recorder((_) => http.Response(
            jsonEncode({
              'enabledMethods': ['password'],
              'authentication': {
                'email': {
                  'signUp': true,
                  'signIn': ['password'],
                },
                'password': {
                  'signUp': true,
                  'minLength': 10,
                  'maxLength': 64,
                },
              },
              'legal': {'required': true, 'version': 7},
              'branding': {'primaryColor': '#0EA5A4'},
              'organizations': true,
              'locale': 'ar',
              'captcha': {
                'provider': 'future-provider',
                'siteKey': 'public-widget-key',
              },
            }),
            200,
          ));
      final client = AuthOwlClient(
        publishableKey: publishableKey,
        apiUrl: 'https://api.authowl.dev',
        storage: storage,
        httpClient: recorder.client,
      );

      final result = await client.getPublicConfig();

      expect(result.data!.passwordMinLength, 10);
      expect(result.data!.legal.version, 7);
      expect(result.data!.organizations, isTrue);
      expect(result.data!.primaryColor, '#0EA5A4');
      expect(result.data!.captcha!.provider, 'future-provider');
      expect(result.data!.captcha!.siteKey, 'public-widget-key');
      expect(recorder.requests.single.url.path, endsWith('/public-config'));
      expect(recorder.requests.single.headers['cookie'], isNull);
      await client.dispose();
    });

    test('normalizes legacy Turnstile config and rejects malformed captcha',
        () {
      final legacy = AuthOwlPublicConfig.fromJson({
        'enabledMethods': <String>[],
        'legal': {'required': false, 'version': 0},
        'authTurnstileSiteKey': 'legacy-site-key',
      });
      expect(legacy!.captcha!.provider, 'turnstile');
      expect(legacy.captcha!.siteKey, 'legacy-site-key');

      expect(
        AuthOwlPublicConfig.fromJson({
          'enabledMethods': <String>[],
          'legal': {'required': false, 'version': 0},
          'captcha': {'provider': '', 'siteKey': 'key'},
        }),
        isNull,
      );
      expect(
        AuthOwlPublicConfig.fromJson({
          'enabledMethods': <String>[],
          'legal': {'required': false, 'version': 0},
          'authTurnstileSiteKey': '',
        }),
        isNull,
      );
    });

    test('sends accepted legal and exact privacy evidence during sign-up',
        () async {
      final recorder = Recorder((_) => http.Response(
            jsonEncode({'sessionCreated': false}),
            200,
          ));
      final client = AuthOwlClient(
        publishableKey: publishableKey,
        apiUrl: 'https://api.authowl.dev',
        storage: InMemoryAuthOwlStorage(),
        httpClient: recorder.client,
      );

      await client.signUpWithEmail(
        email: 'mona@example.test',
        password: 'correct horse',
        name: 'Mona',
        consentVersion: 7,
        privacyEvidence: const <String, Object?>{
          'locale': 'en',
          'correlationId': '55555555-5555-4555-8555-555555555555',
          'noticeVersionIds': <String>['22222222-2222-4222-8222-222222222222'],
          'consentDecisions': <Object?>[],
        },
      );

      final body = jsonDecode(recorder.requests.first.body) as Map;
      expect(body['consentVersion'], 7);
      expect((body['privacyEvidence'] as Map)['locale'], 'en');
      await client.dispose();
    });

    test(
        'lists typed consent preferences through the authenticated project API',
        () async {
      final storage = InMemoryAuthOwlStorage();
      final recorder = Recorder((request) => http.Response(
            jsonEncode({
              'preferences': [
                {
                  'purposeId': 'purpose_1',
                  'purposeVersionId': 'purpose_version_1',
                  'code': 'research',
                  'state': 'granted',
                  'updatedAt': '2026-08-27T10:00:00.000Z',
                  'decidedAt': '2026-08-27T09:00:00.000Z',
                }
              ],
            }),
            200,
          ));
      final client = AuthOwlClient(
        publishableKey: publishableKey,
        apiUrl: 'https://api.authowl.dev',
        storage: storage,
        httpClient: recorder.client,
      );
      await storage.write('authowl.session.$projectId', 'tok_privacy');

      final result = await client.privacy.listConsentPreferences();

      expect(result.data!.single.code, 'research');
      expect(result.data!.single.state, AuthOwlConsentState.granted);
      expect(
        recorder.requests.single.url.path,
        '/api/projects/$projectId/privacy/consent-decisions',
      );
      expect(recorder.requests.single.headers['cookie'],
          '$secureCookie=tok_privacy');
      await client.dispose();
    });

    test('records exact consent evidence and creates typed rights requests',
        () async {
      final recorder = Recorder((request) {
        if (request.url.path.endsWith('/privacy/consent-decisions')) {
          return http.Response(
            jsonEncode({
              'recorded': true,
              'decision': 'withdrawn',
              'decidedAt': '2026-08-27T10:00:00.000Z',
            }),
            200,
          );
        }
        return http.Response(
          jsonEncode({
            'request': {
              'id': 'request_1',
              'rightType': 'consent_withdrawal',
              'state': 'received',
              'locale': 'ar',
              'receivedAt': '2026-08-27T10:00:00.000Z',
              'acknowledgedAt': null,
              'fulfilmentDeadline': '2026-09-27T10:00:00.000Z',
              'completedAt': null,
            },
          }),
          200,
        );
      });
      final client = AuthOwlClient(
        publishableKey: publishableKey,
        apiUrl: 'https://api.authowl.dev',
        storage: InMemoryAuthOwlStorage(),
        httpClient: recorder.client,
      );

      final consent = await client.privacy.recordConsent(
        purposeCode: 'research',
        purposeVersionId: 'purpose_version_1',
        noticeVersionId: 'notice_version_1',
        decision: AuthOwlConsentState.withdrawn,
        locale: AuthOwlPrivacyLocale.ar,
        correlationId: '55555555-5555-4555-8555-555555555555',
      );
      final rights = await client.privacy.createRightsRequest(
        rightType: AuthOwlPrivacyRight.consentWithdrawal,
        locale: AuthOwlPrivacyLocale.ar,
      );

      expect(consent.data, AuthOwlConsentState.withdrawn);
      final consentBody = jsonDecode(recorder.requests.first.body) as Map;
      expect(consentBody['purposeVersionId'], 'purpose_version_1');
      expect(consentBody['noticeVersionId'], 'notice_version_1');
      expect(consentBody['locale'], 'ar');
      expect(rights.data!.rightType, AuthOwlPrivacyRight.consentWithdrawal);
      expect(rights.data!.state, AuthOwlPrivacyRequestState.received);
      final rightsBody = jsonDecode(recorder.requests.last.body) as Map;
      expect(rightsBody['rightType'], 'consent_withdrawal');
      await client.dispose();
    });

    test('prepares a typed Akedly Shield phone OTP challenge', () async {
      final recorder = Recorder((_) => http.Response(
            jsonEncode({
              'kind': 'akedly_shield_v1_2',
              'connectionId': 'connection_1',
              'challenge': 'challenge-bytes',
              'difficulty': 12,
              'challengeToken': 'challenge-token',
              'challengeRequired': true,
              'turnstile': {'required': false, 'siteKey': null},
            }),
            200,
          ));
      final client = AuthOwlClient(
        publishableKey: publishableKey,
        apiUrl: 'https://api.authowl.dev',
        storage: InMemoryAuthOwlStorage(),
        httpClient: recorder.client,
      );

      final result = await client.preparePhoneOtp();

      expect(result.data, isA<AkedlyShieldChallenge>());
      final challenge = result.data! as AkedlyShieldChallenge;
      expect(challenge.connectionId, 'connection_1');
      expect(challenge.difficulty, 12);
      expect(
          recorder.requests.single.url.path, endsWith('/phone-otp/challenge'));
      await client.dispose();
    });

    test('serializes typed Akedly Shield proof when starting phone OTP',
        () async {
      final recorder = Recorder((_) => http.Response(
            jsonEncode({'status': 'pending'}),
            200,
          ));
      final client = AuthOwlClient(
        publishableKey: publishableKey,
        apiUrl: 'https://api.authowl.dev',
        storage: InMemoryAuthOwlStorage(),
        httpClient: recorder.client,
      );

      await client.startPhoneOtp(
        phoneNumber: '+201001112222',
        idempotencyKey: 'otp_1',
        akedlyShield: AkedlyShieldProof(
          connectionId: 'connection_1',
          challengeToken: 'challenge-token',
          nonce: 42,
        ),
      );

      final body = jsonDecode(recorder.requests.single.body) as Map;
      expect(body['akedlyShield'], {
        'connectionId': 'connection_1',
        'challengeToken': 'challenge-token',
        'nonce': 42,
      });
      await client.dispose();
    });

    test('bounds Shield work and refuses incomplete proof pairs', () {
      expect(
        PhoneOtpChallenge.fromJson({
          'kind': 'akedly_shield_v1_2',
          'connectionId': 'connection_1',
          'challenge': 'challenge-bytes',
          'difficulty': maxAkedlyShieldDifficulty + 1,
          'challengeToken': 'challenge-token',
          'challengeRequired': true,
          'turnstile': {'required': false, 'siteKey': null},
        }),
        isNull,
      );
      expect(
        () => AkedlyShieldProof(
          connectionId: 'connection_1',
          challengeToken: 'challenge-token',
        ),
        throwsArgumentError,
      );
    });
  });
}

/// A challenge token has to reach the wire, or a project with an active bot
/// challenge refuses these calls with `403 BOT_CHALLENGE_FAILED` and a Flutter
/// application has no way to complete them.
///
/// The SDK renders nothing: obtaining the token is the application's job, and
/// this is the seam it hands one back through. Each of the six actions the
/// server challenges is covered, because a method that quietly drops the
/// parameter fails only in production.
void _challengeTokenTests() {
  group('bot challenge token', () {
    late Recorder recorder;
    late AuthOwlClient auth;

    setUp(() {
      recorder = Recorder((_) => http.Response('{}', 200));
      auth = AuthOwlClient(
        apiUrl: 'https://api.authowl.dev',
        publishableKey: publishableKey,
        storage: InMemoryAuthOwlStorage(),
        httpClient: recorder.client,
      );
    });

    String? headerOf(int index) =>
        recorder.requests[index].headers['x-authowl-turnstile-token'];

    test('reaches the wire for every challenged action', () async {
      await auth.signInWithEmail(
          email: 'a@b.test', password: 'pw', challengeToken: 't-signin');
      await auth.signUpWithEmail(
          email: 'a@b.test', password: 'pw', challengeToken: 't-signup');
      await auth.sendMagicLink(email: 'a@b.test', challengeToken: 't-magic');
      await auth.sendEmailOtp(email: 'a@b.test', challengeToken: 't-otp');
      await auth.requestPasswordReset(
          email: 'a@b.test', challengeToken: 't-reset');
      await auth.sendVerificationEmail(
          email: 'a@b.test', challengeToken: 't-verify');

      final sent = recorder.requests
          .where((r) => r.headers.containsKey('x-authowl-turnstile-token'))
          .map((r) => r.headers['x-authowl-turnstile-token'])
          .toList();
      expect(
        sent,
        containsAll([
          't-signin',
          't-signup',
          't-magic',
          't-otp',
          't-reset',
          't-verify'
        ]),
      );
    });

    test('is absent when none is supplied, rather than sent empty', () async {
      // An empty header is not the same as no header: the server would read it
      // as a token and refuse it, turning "this project has no challenge" into
      // a refusal.
      await auth.sendMagicLink(email: 'a@b.test');
      expect(headerOf(0), isNull);

      await auth.sendMagicLink(email: 'a@b.test', challengeToken: '');
      expect(headerOf(1), isNull);
    });
  });
}
