/// The widget that owns the AuthOwl client and publishes session state.
library;

import 'dart:async' show StreamSubscription;

import '../authowl_client.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;

import 'i18n/messages.dart';
import 'theme.dart';

/// Provides the AuthOwl client, live session state, and locale to a widget tree.
///
/// Owns the client rather than taking one, because the client holds a cookie
/// jar and an in-flight session request: rebuilding it on every widget rebuild
/// would restart that request forever.
class AuthOwlProvider extends StatefulWidget {
  const AuthOwlProvider({
    required this.publishableKey,
    required this.apiUrl,
    required this.storage,
    required this.child,
    this.locale = fallbackLocale,
    this.httpClient,
    this.primaryColor,
    super.key,
  });

  final String publishableKey;
  final String apiUrl;

  /// Where the session cookie lives. Use the OS keychain
  /// (`flutter_secure_storage`) in production, never `SharedPreferences`: the
  /// session is a bearer credential and `SharedPreferences` is unencrypted.
  final AuthOwlStorage storage;

  /// Locale for the built-in widgets.
  ///
  /// Not read from the device: a phone set to Arabic does not mean the app is
  /// localized to Arabic, and switching only the auth screens is worse than
  /// defaulting.
  final String locale;

  /// Injectable HTTP stack, for tests and for apps with their own transport.
  /// The caller retains ownership and remains responsible for closing it.
  final http.Client? httpClient;

  /// Optional app-level brand override. When omitted, the project color from
  /// public config wins, then AuthOwl gold is used as the stable default.
  final Color? primaryColor;

  final Widget child;

  @override
  State<AuthOwlProvider> createState() => _AuthOwlProviderState();

  /// The nearest provider's scope.
  static AuthOwlScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AuthOwlScope>();
    if (scope == null) {
      throw FlutterError(
        'AuthOwl widgets must be used inside an AuthOwlProvider.',
      );
    }
    return scope;
  }
}

class _AuthOwlProviderState extends State<AuthOwlProvider> {
  late AuthOwlClient _client;
  AuthOwlSessionState _session = const AuthOwlSessionState(isLoading: true);
  AuthOwlPublicConfig? _publicConfig;
  AuthOwlPublicConfigState _publicConfigState =
      AuthOwlPublicConfigState.loading;
  StreamSubscription<AuthOwlSessionState>? _sessionSubscription;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _build();
  }

  @override
  void didUpdateWidget(AuthOwlProvider oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only identity-bearing configuration justifies a rebuild. A locale change
    // must NOT discard the session.
    if (oldWidget.publishableKey != widget.publishableKey ||
        oldWidget.apiUrl != widget.apiUrl ||
        !identical(oldWidget.storage, widget.storage) ||
        !identical(oldWidget.httpClient, widget.httpClient)) {
      final previous = _client;
      _build();
      unawaited(previous.dispose());
    }
  }

  void _build() {
    final generation = ++_generation;
    final oldSubscription = _sessionSubscription;
    if (oldSubscription != null) unawaited(oldSubscription.cancel());
    _session = const AuthOwlSessionState(isLoading: true);
    _publicConfig = null;
    _publicConfigState = AuthOwlPublicConfigState.loading;
    _client = AuthOwlClient(
      publishableKey: widget.publishableKey,
      apiUrl: widget.apiUrl,
      storage: widget.storage,
      httpClient: widget.httpClient,
    );
    final client = _client;
    _sessionSubscription = client.session.changes.listen((state) {
      if (mounted && generation == _generation) {
        setState(() => _session = state);
      }
    });
    unawaited(client.getSession());
    unawaited(_loadPublicConfig(client, generation));
  }

  Future<void> _loadPublicConfig(AuthOwlClient client, int generation) async {
    final result = await client.getPublicConfig();
    if (!mounted || generation != _generation) return;
    setState(() {
      _publicConfig = result.data;
      _publicConfigState = result.isSuccess
          ? AuthOwlPublicConfigState.ready
          : AuthOwlPublicConfigState.error;
    });
  }

  @override
  void dispose() {
    _generation += 1;
    final subscription = _sessionSubscription;
    if (subscription != null) unawaited(subscription.cancel());
    unawaited(_client.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection:
          isRightToLeft(widget.locale) ? TextDirection.rtl : TextDirection.ltr,
      child: AuthOwlScope(
        client: _client,
        session: _session,
        publicConfig: _publicConfig,
        publicConfigState: _publicConfigState,
        locale: widget.locale,
        primaryColor: widget.primaryColor ??
            parseAuthOwlColor(_publicConfig?.primaryColor) ??
            authOwlBrandColor,
        child: widget.child,
      ),
    );
  }
}

enum AuthOwlPublicConfigState { loading, ready, error }

/// What the provider publishes down the tree.
class AuthOwlScope extends InheritedWidget {
  const AuthOwlScope({
    required this.client,
    required this.session,
    required this.publicConfig,
    required this.publicConfigState,
    required this.locale,
    required this.primaryColor,
    required super.child,
    super.key,
  });

  final AuthOwlClient client;
  final AuthOwlSessionState session;
  final AuthOwlPublicConfig? publicConfig;
  final AuthOwlPublicConfigState publicConfigState;
  final String locale;
  final Color primaryColor;

  /// Translate a catalog key in the active locale.
  String t(String key, [Map<String, Object?>? params]) =>
      formatMessage(locale, key, params);

  /// A localized sentence for a failed action.
  ///
  /// Falls back to the given key rather than surfacing a raw server string: an
  /// untranslated backend error inside an Arabic screen is both a leak and a UX
  /// failure.
  String errorMessage(AuthError? error, String fallbackKey) {
    final code = error?.code;
    if (code != null) {
      final localized = formatMessage(locale, 'error.$code');
      if (localized != 'error.$code') return localized;
    }
    return t(fallbackKey);
  }

  @override
  bool updateShouldNotify(AuthOwlScope oldWidget) =>
      !identical(oldWidget.client, client) ||
      oldWidget.locale != locale ||
      oldWidget.primaryColor != primaryColor ||
      !identical(oldWidget.session, session) ||
      !identical(oldWidget.publicConfig, publicConfig) ||
      oldWidget.publicConfigState != publicConfigState;
}

/// Fire-and-forget, named so the intent is explicit at each call site.
void unawaited(Future<void> future) {
  future.catchError((Object _) {});
}
