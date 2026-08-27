/// Widget tests for the drop-in auth screens.
///
/// These assert behaviour and wording, not pixels: layout and platform styling
/// are verified on a device, not in a headless test.
library;

import 'dart:convert';
import 'dart:async';

import 'package:authowl/authowl.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const projectId = '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60';
const publishableKey = 'pk_live_${projectId}_A1b2C3d4E5f6G7h8I9j0';
const secondProjectId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const secondPublishableKey = 'pk_live_${secondProjectId}_A1b2C3d4E5f6G7h8I9j0';

/// Records requests and replies with whatever the test scripts.
class Recorder {
  Recorder(this._respond);
  final http.Response Function(http.Request) _respond;
  final List<http.Request> requests = <http.Request>[];

  MockClient get client => MockClient((http.Request request) async {
        requests.add(request);
        return _respond(request);
      });

  Map<String, Object?> bodyOf(int index) =>
      jsonDecode(requests[index].body) as Map<String, Object?>;

  http.Request requestEndingWith(String suffix) =>
      requests.firstWhere((request) => request.url.path.endsWith(suffix));

  Map<String, Object?> bodyEndingWith(String suffix) =>
      jsonDecode(requestEndingWith(suffix).body) as Map<String, Object?>;
}

Widget host(
  Widget child,
  Recorder recorder, {
  String locale = 'en',
  String key = publishableKey,
  AuthOwlStorage? storage,
  ThemeData? theme,
  Color? primaryColor,
}) {
  return MaterialApp(
    theme: theme,
    home: Scaffold(
      body: AuthOwlProvider(
        publishableKey: key,
        apiUrl: 'https://api.authowl.dev',
        storage: storage ?? InMemoryAuthOwlStorage(),
        httpClient: recorder.client,
        locale: locale,
        primaryColor: primaryColor,
        child: child,
      ),
    ),
  );
}

Map<String, Object?> publicConfig({
  bool consentRequired = false,
  bool privacyEnabled = false,
  String? primaryColor,
}) =>
    {
      'enabledMethods': ['password'],
      'authentication': {
        'email': {
          'signUp': true,
          'signIn': ['password'],
        },
        'password': {'signUp': true, 'minLength': 8, 'maxLength': 128},
      },
      'legal': {
        'required': consentRequired,
        'version': consentRequired ? 7 : 0,
        if (consentRequired) 'termsUrl': 'https://example.test/terms',
        if (consentRequired) 'privacyUrl': 'https://example.test/privacy',
      },
      'organizations': false,
      'locale': 'en',
      if (privacyEnabled)
        'privacy': {
          'notices': [
            {
              'noticeVersionId': '22222222-2222-4222-8222-222222222222',
              'title': {
                'en': 'Privacy at sign-up',
                'ar': 'الخصوصية عند التسجيل'
              },
              'body': {
                'en': 'How this app uses your data.',
                'ar': 'كيفية استخدام التطبيق لبياناتك.'
              },
              'purposeCodes': ['research'],
            }
          ],
          'consentPurposes': [
            {
              'purposeVersionId': '44444444-4444-4444-8444-444444444444',
              'code': 'research',
              'title': {'en': 'Optional research', 'ar': 'أبحاث اختيارية'},
              'description': {
                'en': 'Help improve the app.',
                'ar': 'المساعدة في تحسين التطبيق.'
              },
            }
          ],
        },
      if (primaryColor != null) 'branding': {'primaryColor': primaryColor},
    };

class BlockingStorage implements AuthOwlStorage {
  final Completer<String?> readResult = Completer<String?>();

  @override
  Future<void> delete(String key) async {}

  @override
  Future<String?> read(String key) => readResult.future;

  @override
  Future<void> write(String key, String value) async {}
}

class SessionProbe extends StatelessWidget {
  const SessionProbe({super.key});

  @override
  Widget build(BuildContext context) {
    final session = AuthOwlProvider.of(context).session;
    return Text(
      session.user?.id ?? (session.isLoading ? 'loading' : 'signed-out'),
      key: const Key('authowl-session-probe'),
    );
  }
}

http.Response ok(Object? body) => http.Response(
      jsonEncode(body),
      200,
      headers: <String, String>{'content-type': 'application/json'},
    );

FilledButton buttonAt(WidgetTester tester, String key) =>
    tester.widget<FilledButton>(
      find.descendant(
        of: find.byKey(Key(key)),
        matching: find.byType(FilledButton),
      ),
    );

Future<void> fill(WidgetTester tester, String key, String value) async {
  await tester.enterText(find.byKey(Key(key)), value);
  await tester.pump();
}

void main() {
  group('AuthOwlSignIn', () {
    testWidgets('mints and sends a fresh challenge token', (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{
            'user': <String, Object?>{'id': 'u1'},
          }));
      AuthOwlChallengeAction? requestedAction;
      await tester.pumpWidget(
        host(
          AuthOwlSignIn(
            challengeTokenProvider: (action) async {
              requestedAction = action;
              return 'signin-token';
            },
          ),
          recorder,
        ),
      );
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signin-email', 'mona@example.test');
      await fill(tester, 'authowl-signin-password', 'correct horse');
      await tester.tap(find.byKey(const Key('authowl-signin-submit')));
      await tester.pumpAndSettle();

      expect(requestedAction, AuthOwlChallengeAction.signIn);
      expect(
        recorder
            .requestEndingWith('/sign-in/email')
            .headers[authChallengeHeader],
        'signin-token',
      );
    });

    testWidgets('renders wording from the generated catalog', (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{}));
      await tester.pumpWidget(host(const AuthOwlSignIn(), recorder));
      await tester.pumpAndSettle();

      expect(find.text('Sign in'), findsWidgets);
      expect(find.text('Email'), findsOneWidget);
      expect(find.text('Password'), findsOneWidget);
    });

    testWidgets('renders Arabic from the same catalog', (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{}));
      await tester
          .pumpWidget(host(const AuthOwlSignIn(), recorder, locale: 'ar'));
      await tester.pumpAndSettle();

      // Proves the generated Dart catalog carries every locale, so Flutter
      // wording cannot drift from the web wording.
      expect(find.text('Email'), findsNothing);
      expect(find.text('البريد الإلكتروني'), findsOneWidget);
      expect(
        Directionality.of(tester.element(find.text('البريد الإلكتروني'))),
        TextDirection.rtl,
      );
    });

    testWidgets('keeps submit disabled until both credentials exist',
        (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{}));
      await tester.pumpWidget(host(const AuthOwlSignIn(), recorder));
      await tester.pumpAndSettle();

      expect(buttonAt(tester, 'authowl-signin-submit').onPressed, isNull);

      await fill(tester, 'authowl-signin-email', 'mona@example.test');
      await fill(tester, 'authowl-signin-password', 'correct horse');

      expect(buttonAt(tester, 'authowl-signin-submit').onPressed, isNotNull);
    });

    testWidgets('trims the email but never the password', (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{
            'user': <String, Object?>{'id': 'u1'},
          }));
      await tester.pumpWidget(host(const AuthOwlSignIn(), recorder));
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signin-email', '  mona@example.test  ');
      await fill(tester, 'authowl-signin-password', ' spaces matter ');
      await tester.tap(find.byKey(const Key('authowl-signin-submit')));
      await tester.pumpAndSettle();

      final body = recorder.bodyEndingWith('/sign-in/email');
      expect(body['email'], 'mona@example.test');
      // Trailing spaces are legitimate password characters.
      expect(body['password'], ' spaces matter ');
    });

    testWidgets('hands a two-factor challenge back to the host',
        (tester) async {
      final recorder =
          Recorder((_) => ok(<String, Object?>{'twoFactorRedirect': true}));
      var signedIn = false;
      var secondFactorRequired = false;
      await tester.pumpWidget(
        host(
          AuthOwlSignIn(
            onSignedIn: () => signedIn = true,
            onSecondFactorRequired: () => secondFactorRequired = true,
          ),
          recorder,
        ),
      );
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signin-email', 'mona@example.test');
      await fill(tester, 'authowl-signin-password', 'correct horse');
      await tester.tap(find.byKey(const Key('authowl-signin-submit')));
      await tester.pumpAndSettle();

      // A challenge is neither a failure nor a session; reporting success would
      // let an app navigate past the second factor.
      expect(signedIn, isFalse);
      expect(secondFactorRequired, isTrue);
      expect(find.byKey(const Key('authowl-error')), findsNothing);
    });

    testWidgets('shows a failure and stays on the form', (tester) async {
      final recorder = Recorder(
        (_) => http.Response(
          jsonEncode(<String, Object?>{'code': 'INVALID_CREDENTIALS'}),
          401,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      );
      var signedIn = false;
      await tester.pumpWidget(
        host(AuthOwlSignIn(onSignedIn: () => signedIn = true), recorder),
      );
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signin-email', 'mona@example.test');
      await fill(tester, 'authowl-signin-password', 'nope');
      await tester.tap(find.byKey(const Key('authowl-signin-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('authowl-error')), findsOneWidget);
      expect(signedIn, isFalse);
    });
  });

  group('AuthOwlSignUp', () {
    testWidgets('mints and sends a fresh challenge token', (tester) async {
      final recorder =
          Recorder((_) => ok(<String, Object?>{'sessionCreated': false}));
      AuthOwlChallengeAction? requestedAction;
      await tester.pumpWidget(
        host(
          AuthOwlSignUp(
            challengeTokenProvider: (action) async {
              requestedAction = action;
              return 'signup-token';
            },
          ),
          recorder,
        ),
      );
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signup-name', 'Mona');
      await fill(tester, 'authowl-signup-email', 'mona@example.test');
      await fill(tester, 'authowl-signup-password', 'correct horse');
      await tester.ensureVisible(
        find.byKey(const Key('authowl-signup-submit')),
      );
      await tester.tap(find.byKey(const Key('authowl-signup-submit')));
      await tester.pumpAndSettle();

      expect(requestedAction, AuthOwlChallengeAction.signUp);
      expect(
        recorder
            .requestEndingWith('/sign-up/email')
            .headers[authChallengeHeader],
        'signup-token',
      );
    });

    testWidgets('requires the display name the server demands', (tester) async {
      final recorder =
          Recorder((_) => ok(<String, Object?>{'sessionCreated': true}));
      await tester.pumpWidget(host(const AuthOwlSignUp(), recorder));
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signup-email', 'mona@example.test');
      await fill(tester, 'authowl-signup-password', 'correct horse');
      expect(buttonAt(tester, 'authowl-signup-submit').onPressed, isNull);

      await fill(tester, 'authowl-signup-name', 'Mona');
      expect(buttonAt(tester, 'authowl-signup-submit').onPressed, isNotNull);
    });

    testWidgets('reports whether a session was created', (tester) async {
      final recorder =
          Recorder((_) => ok(<String, Object?>{'sessionCreated': false}));
      bool? created;
      await tester.pumpWidget(host(
        AuthOwlSignUp(
          onSignedUp: ({required bool sessionCreated}) =>
              created = sessionCreated,
        ),
        recorder,
      ));
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signup-name', 'Mona');
      await fill(tester, 'authowl-signup-email', 'mona@example.test');
      await fill(tester, 'authowl-signup-password', 'correct horse');
      await tester.tap(find.byKey(const Key('authowl-signup-submit')));
      await tester.pumpAndSettle();

      // Verification-required projects create no session; "check your email" is
      // a different screen from "you are in".
      expect(created, isFalse);
    });

    testWidgets('collects and sends required legal consent', (tester) async {
      final recorder = Recorder((request) {
        if (request.url.path.endsWith('/public-config')) {
          return ok(publicConfig(consentRequired: true));
        }
        return ok(<String, Object?>{'sessionCreated': true});
      });
      await tester.pumpWidget(host(const AuthOwlSignUp(), recorder));
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-signup-name', 'Mona');
      await fill(tester, 'authowl-signup-email', 'mona@example.test');
      await fill(tester, 'authowl-signup-password', 'correct horse');
      expect(buttonAt(tester, 'authowl-signup-submit').onPressed, isNull);

      expect(find.text('Terms of Service'), findsOneWidget);
      expect(find.text('Privacy Policy'), findsOneWidget);
      final consent = tester.widget<Checkbox>(
        find.descendant(
          of: find.byKey(const Key('authowl-signup-consent')),
          matching: find.byType(Checkbox),
        ),
      );
      expect(consent.activeColor, authOwlBrandColor);
      expect(consent.checkColor, authOwlBrandForeground);
      expect(
        tester.getTopLeft(find.byKey(const Key('authowl-signup-consent'))).dy,
        lessThan(tester
            .getTopLeft(find.byKey(const Key('authowl-signup-submit')))
            .dy),
      );

      await tester.tap(find.byKey(const Key('authowl-signup-consent-control')));
      await tester.pump();
      expect(buttonAt(tester, 'authowl-signup-submit').onPressed, isNotNull);
      await tester.tap(find.byKey(const Key('authowl-signup-submit')));
      await tester.pumpAndSettle();

      expect(recorder.bodyEndingWith('/sign-up/email')['consentVersion'], 7);
    });

    testWidgets('renders notices and sends exact optional-purpose evidence',
        (tester) async {
      final recorder = Recorder((request) {
        if (request.url.path.endsWith('/public-config')) {
          return ok(publicConfig(privacyEnabled: true));
        }
        return ok(<String, Object?>{'sessionCreated': true});
      });
      await tester.pumpWidget(host(const AuthOwlSignUp(), recorder));
      await tester.pumpAndSettle();

      expect(find.text('How this app uses your data.'), findsOneWidget);
      await tester
          .tap(find.byKey(const Key('authowl-signup-purpose-research')));
      await tester.pump();
      await fill(tester, 'authowl-signup-name', 'Mona');
      await fill(tester, 'authowl-signup-email', 'mona@example.test');
      await fill(tester, 'authowl-signup-password', 'correct horse');
      await tester.ensureVisible(
        find.byKey(const Key('authowl-signup-submit')),
      );
      await tester.tap(find.byKey(const Key('authowl-signup-submit')));
      await tester.pumpAndSettle();

      final evidence =
          recorder.bodyEndingWith('/sign-up/email')['privacyEvidence']
              as Map<String, Object?>;
      expect(evidence['locale'], 'en');
      expect(
          evidence['correlationId'],
          matches(
            RegExp(
                r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
          ));
      expect(evidence['noticeVersionIds'],
          ['22222222-2222-4222-8222-222222222222']);
      final decisions = evidence['consentDecisions'] as List<Object?>;
      expect(decisions.single, containsPair('decision', 'granted'));
    });

    testWidgets('manages consent and submits data-rights requests',
        (tester) async {
      final storage = InMemoryAuthOwlStorage();
      await storage.write('authowl.session.$projectId', 'tok_privacy');
      final recorder = Recorder((request) {
        final path = request.url.path;
        if (path.endsWith('/public-config')) {
          return ok(publicConfig(privacyEnabled: true));
        }
        if (path.endsWith('/get-session')) {
          return ok({
            'user': {'id': 'user_1'},
            'session': {'id': 'session_1'},
          });
        }
        if (path.endsWith('/privacy/consent-decisions')) {
          if (request.method == 'POST') {
            return ok({
              'recorded': true,
              'decision': 'withdrawn',
              'decidedAt': '2026-08-27T10:00:00.000Z',
            });
          }
          return ok({
            'preferences': [
              {
                'purposeId': 'purpose_1',
                'purposeVersionId': '44444444-4444-4444-8444-444444444444',
                'code': 'research',
                'state': 'granted',
                'updatedAt': '2026-08-27T10:00:00.000Z',
                'decidedAt': '2026-08-27T10:00:00.000Z',
              }
            ],
          });
        }
        if (request.method == 'POST') {
          return ok({
            'request': {
              'id': 'request_2',
              'rightType': 'erasure',
              'state': 'received',
              'locale': 'en',
              'receivedAt': '2026-08-27T10:00:00.000Z',
              'acknowledgedAt': null,
              'fulfilmentDeadline': '2026-09-27T10:00:00.000Z',
              'completedAt': null,
            },
          });
        }
        return ok({
          'requests': [
            {
              'id': 'request_1',
              'rightType': 'access',
              'state': 'received',
              'locale': 'en',
              'receivedAt': '2026-08-27T10:00:00.000Z',
              'acknowledgedAt': null,
              'fulfilmentDeadline': '2026-09-27T10:00:00.000Z',
              'completedAt': null,
            }
          ],
        });
      });

      await tester.pumpWidget(host(
        const AuthOwlPrivacyCenter(),
        recorder,
        storage: storage,
      ));
      await tester.pumpAndSettle();

      expect(find.text('Privacy center'), findsOneWidget);
      expect(find.text('Received'), findsOneWidget);
      await tester
          .tap(find.byKey(const Key('authowl-privacy-purpose-research')));
      await tester.pumpAndSettle();
      final consentRequest = recorder.requests.lastWhere((request) =>
          request.method == 'POST' &&
          request.url.path.endsWith('/privacy/consent-decisions'));
      expect(
        (jsonDecode(consentRequest.body) as Map)['decision'],
        'withdrawn',
      );

      final erasure = find.byKey(const Key('authowl-privacy-right-erasure'));
      await tester.ensureVisible(erasure);
      await tester.tap(erasure);
      await tester.pumpAndSettle();
      final rightsRequest = recorder.requests.lastWhere((request) =>
          request.method == 'POST' &&
          request.url.path.endsWith('/privacy/rights'));
      expect((jsonDecode(rightsRequest.body) as Map)['rightType'], 'erasure');
    });

    testWidgets('uses project branding in light and dark modes',
        (tester) async {
      const projectColor = Color(0xff0ea5a4);
      final recorder = Recorder((request) {
        if (request.url.path.endsWith('/public-config')) {
          return ok(publicConfig(
            consentRequired: true,
            primaryColor: '#0EA5A4',
          ));
        }
        return ok(<String, Object?>{'sessionCreated': true});
      });

      for (final brightness in <Brightness>[
        Brightness.light,
        Brightness.dark
      ]) {
        final theme = ThemeData(
          brightness: brightness,
        );
        await tester.pumpWidget(host(
          const AuthOwlSignUp(),
          recorder,
          theme: theme,
        ));
        await tester.pumpAndSettle();

        final checkbox = tester.widget<Checkbox>(
          find.descendant(
            of: find.byKey(const Key('authowl-signup-consent')),
            matching: find.byType(Checkbox),
          ),
        );
        expect(checkbox.activeColor, projectColor);
        expect(checkbox.checkColor, authOwlBrandForeground);
      }
    });

    testWidgets('lets an explicit app color override project branding',
        (tester) async {
      const appColor = Color(0xffc0563e);
      final recorder = Recorder((request) {
        if (request.url.path.endsWith('/public-config')) {
          return ok(publicConfig(
            consentRequired: true,
            primaryColor: '#0EA5A4',
          ));
        }
        return ok(<String, Object?>{'sessionCreated': true});
      });

      await tester.pumpWidget(host(
        const AuthOwlSignUp(),
        recorder,
        primaryColor: appColor,
      ));
      await tester.pumpAndSettle();

      final checkbox = tester.widget<Checkbox>(
        find.descendant(
          of: find.byKey(const Key('authowl-signup-consent')),
          matching: find.byType(Checkbox),
        ),
      );
      expect(checkbox.activeColor, appColor);
    });
  });

  group('AuthOwlProvider', () {
    testWidgets('clears the old session before changing projects',
        (tester) async {
      final firstStorage = InMemoryAuthOwlStorage();
      final recorder = Recorder((request) {
        if (request.url.path.endsWith('/public-config'))
          return ok(publicConfig());
        return ok({
          'user': {'id': 'user-a'},
          'session': {'id': 'session-a'},
        });
      });
      await tester.pumpWidget(host(
        Column(children: const [AuthOwlSignIn(), SessionProbe()]),
        recorder,
        storage: firstStorage,
      ));
      await tester.pumpAndSettle();
      await fill(tester, 'authowl-signin-email', 'mona@example.test');
      await fill(tester, 'authowl-signin-password', 'correct horse');
      await tester.tap(find.byKey(const Key('authowl-signin-submit')));
      await tester.pumpAndSettle();
      expect(find.text('user-a'), findsOneWidget);

      final secondStorage = BlockingStorage();
      await tester.pumpWidget(host(
        const SessionProbe(),
        recorder,
        key: secondPublishableKey,
        storage: secondStorage,
      ));
      await tester.pump();

      expect(find.text('user-a'), findsNothing);
      expect(find.text('loading'), findsOneWidget);
      secondStorage.readResult.complete(null);
      await tester.pumpAndSettle();
    });
  });

  group('AuthOwlEmailOtpForm', () {
    testWidgets(
        'mints and sends a fresh challenge token before requesting a code',
        (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{}));
      AuthOwlChallengeAction? requestedAction;
      await tester.pumpWidget(
        host(
          AuthOwlEmailOtpForm(
            challengeTokenProvider: (action) async {
              requestedAction = action;
              return 'passwordless-token';
            },
          ),
          recorder,
        ),
      );
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-emailotp-email', 'mona@example.test');
      await tester.tap(find.byKey(const Key('authowl-emailotp-request')));
      await tester.pumpAndSettle();

      expect(requestedAction, AuthOwlChallengeAction.passwordless);
      expect(
        recorder
            .requestEndingWith('/email-otp/send-verification-otp')
            .headers[authChallengeHeader],
        'passwordless-token',
      );
    });

    testWidgets('advances to the code stage only after the code is sent',
        (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{'success': true}));
      await tester.pumpWidget(host(const AuthOwlEmailOtpForm(), recorder));
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-emailotp-email', 'mona@example.test');
      await tester.tap(find.byKey(const Key('authowl-emailotp-request')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('authowl-emailotp-code')), findsOneWidget);
    });

    testWidgets('discards a code minted for the previous address',
        (tester) async {
      final recorder = Recorder((_) => ok(<String, Object?>{'success': true}));
      await tester.pumpWidget(host(const AuthOwlEmailOtpForm(), recorder));
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-emailotp-email', 'mona@example.test');
      await tester.tap(find.byKey(const Key('authowl-emailotp-request')));
      await tester.pumpAndSettle();

      await fill(tester, 'authowl-emailotp-code', '123456');
      await tester.tap(find.byKey(const Key('authowl-emailotp-change')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('authowl-emailotp-request')));
      await tester.pumpAndSettle();

      final field = tester.widget<TextField>(find.descendant(
        of: find.byKey(const Key('authowl-emailotp-code')),
        matching: find.byType(TextField),
      ));
      expect(field.controller!.text, isEmpty);
    });
  });
}
