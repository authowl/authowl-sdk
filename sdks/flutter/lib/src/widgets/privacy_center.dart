/// Drop-in consent preferences and data-rights center.
library;

import 'package:flutter/material.dart';

import '../../authowl_client.dart';
import '../provider.dart';
import '../theme.dart';

/// Manage optional data uses and submit access, correction, export, deletion,
/// restriction, objection, or consent-withdrawal requests.
class AuthOwlPrivacyCenter extends StatefulWidget {
  const AuthOwlPrivacyCenter({super.key});

  @override
  State<AuthOwlPrivacyCenter> createState() => _AuthOwlPrivacyCenterState();
}

class _AuthOwlPrivacyCenterState extends State<AuthOwlPrivacyCenter> {
  List<AuthOwlConsentPreference> _preferences = const [];
  List<AuthOwlPrivacyRequest> _requests = const [];
  bool _loading = true;
  String? _error;
  String? _pendingPurpose;
  AuthOwlPrivacyRight? _pendingRight;
  String? _loadedUserId;
  AuthOwlClient? _loadedClient;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final scope = AuthOwlProvider.of(context);
    final userId = scope.session.user?.id;
    if (!scope.session.isLoading &&
        (userId != _loadedUserId || !identical(scope.client, _loadedClient))) {
      _loadedUserId = userId;
      _loadedClient = scope.client;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _refresh(showLoading: true);
      });
    }
  }

  Future<void> _refresh({bool showLoading = false}) async {
    final scope = AuthOwlProvider.of(context);
    if (!scope.session.isSignedIn) {
      setState(() => _loading = false);
      return;
    }
    if (showLoading) setState(() => _loading = true);
    final consentFuture = scope.client.privacy.listConsentPreferences();
    final rightsFuture = scope.client.privacy.listRightsRequests();
    final consent = await consentFuture;
    final rights = await rightsFuture;
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (consent.error != null || rights.error != null) {
        _error = scope.errorMessage(
          consent.error ?? rights.error,
          'privacy.error.load',
        );
      } else {
        _preferences = consent.data!;
        _requests = rights.data!;
        _error = null;
      }
    });
  }

  Future<void> _updateConsent(String purposeCode, bool granted) async {
    final scope = AuthOwlProvider.of(context);
    final privacy = scope.publicConfig?.privacy;
    final purpose = privacy?.consentPurposes
        .where((item) => item.code == purposeCode)
        .firstOrNull;
    final notice = privacy?.notices
        .where((item) => item.purposeCodes.contains(purposeCode))
        .firstOrNull;
    if (purpose == null || notice == null) {
      setState(() => _error = scope.t('privacy.error.unavailable'));
      return;
    }
    setState(() {
      _pendingPurpose = purposeCode;
      _error = null;
    });
    final result = await scope.client.privacy.recordConsent(
      purposeCode: purposeCode,
      purposeVersionId: purpose.purposeVersionId,
      noticeVersionId: notice.noticeVersionId,
      decision:
          granted ? AuthOwlConsentState.granted : AuthOwlConsentState.withdrawn,
      locale: scope.locale == 'ar'
          ? AuthOwlPrivacyLocale.ar
          : AuthOwlPrivacyLocale.en,
    );
    if (!mounted) return;
    if (result.error != null) {
      setState(() {
        _pendingPurpose = null;
        _error = scope.errorMessage(result.error, 'privacy.error.save');
      });
      return;
    }
    await _refresh();
    if (mounted) setState(() => _pendingPurpose = null);
  }

  Future<void> _createRequest(AuthOwlPrivacyRight right) async {
    final scope = AuthOwlProvider.of(context);
    setState(() {
      _pendingRight = right;
      _error = null;
    });
    final result = await scope.client.privacy.createRightsRequest(
      rightType: right,
      locale: scope.locale == 'ar'
          ? AuthOwlPrivacyLocale.ar
          : AuthOwlPrivacyLocale.en,
    );
    if (!mounted) return;
    if (result.error != null) {
      setState(() {
        _pendingRight = null;
        _error = scope.errorMessage(result.error, 'privacy.error.request');
      });
      return;
    }
    await _refresh();
    if (mounted) setState(() => _pendingRight = null);
  }

  @override
  Widget build(BuildContext context) {
    final scope = AuthOwlProvider.of(context);
    if (scope.session.isLoading || _loading) {
      return Center(
        child: CircularProgressIndicator(
          key: const Key('authowl-privacy-loading'),
          color: scope.primaryColor,
        ),
      );
    }
    if (!scope.session.isSignedIn) {
      return Text(scope.t('privacy.signedOut'));
    }

    final theme = authOwlThemeData(Theme.of(context), scope.primaryColor);
    final privacy = scope.publicConfig?.privacy;
    final offeredRights = offeredRightsFor(privacy);
    final preferencesByCode = <String, AuthOwlConsentPreference>{
      for (final preference in _preferences) preference.code: preference,
    };
    return Theme(
      data: theme,
      child: SingleChildScrollView(
        child: Column(
          key: const Key('authowl-privacy-center'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(scope.t('privacy.dataUse'),
                style: theme.textTheme.labelMedium),
            const SizedBox(height: 4),
            Text(scope.t('privacy.title'),
                style: theme.textTheme.headlineSmall),
            const SizedBox(height: 4),
            Text(scope.t('privacy.description'),
                style: theme.textTheme.bodyMedium),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 12),
              Semantics(
                liveRegion: true,
                child: Text(
                  _error!,
                  key: const Key('authowl-privacy-error'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            ],
            const SizedBox(height: 16),
            _PrivacyCard(
              title: scope.t('privacy.choices.title'),
              description: scope.t('privacy.choices.description'),
              children: <Widget>[
                if ((privacy?.consentPurposes.isEmpty ?? true))
                  Text(scope.t('privacy.choices.empty'))
                else
                  ...privacy!.consentPurposes.map((purpose) {
                    final granted = preferencesByCode[purpose.code]?.state ==
                        AuthOwlConsentState.granted;
                    final pending = _pendingPurpose == purpose.code;
                    final locale = scope.locale == 'ar' ? 'ar' : 'en';
                    return SwitchListTile.adaptive(
                      key: Key('authowl-privacy-purpose-${purpose.code}'),
                      contentPadding: EdgeInsets.zero,
                      title: Text(purpose.title[locale] ?? ''),
                      subtitle: Text(purpose.description[locale] ?? ''),
                      value: granted,
                      activeTrackColor: scope.primaryColor,
                      onChanged: pending
                          ? null
                          : (value) => _updateConsent(purpose.code, value),
                    );
                  }),
              ],
            ),
            const SizedBox(height: 12),
            _PrivacyCard(
              title: scope.t('privacy.rights.title'),
              description: scope.t('privacy.rights.description'),
              children: <Widget>[
                if (offeredRights.isEmpty)
                  Text(
                    scope.t('privacy.rights.unavailable'),
                    style: theme.textTheme.bodySmall,
                  )
                else
                  Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: offeredRights.map((right) {
                    final pending = _pendingRight == right;
                    final destructive = right == AuthOwlPrivacyRight.erasure;
                    return OutlinedButton(
                      key: Key('authowl-privacy-right-${_rightWire(right)}'),
                      onPressed: _pendingRight == null
                          ? () => _createRequest(right)
                          : null,
                      style: destructive
                          ? OutlinedButton.styleFrom(
                              foregroundColor: theme.colorScheme.error,
                              side: BorderSide(color: theme.colorScheme.error),
                            )
                          : null,
                      child: Text(pending
                          ? scope.t('common.working')
                          : scope.t(_rightKey(right))),
                    );
                  }).toList(growable: false),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _PrivacyCard(
              title: scope.t('privacy.requests.title'),
              description: scope.t('privacy.requests.description'),
              children: <Widget>[
                if (_requests.isEmpty)
                  Text(scope.t('privacy.requests.empty'))
                else
                  ..._requests.map((request) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(scope.t(_rightKey(request.rightType))),
                        trailing: Text(scope.t(_stateKey(request.state))),
                      )),
              ],
            ),
            if ((privacy?.notices.isNotEmpty ?? false)) ...<Widget>[
              const SizedBox(height: 12),
              _PrivacyCard(
                title: scope.t('privacy.notices.title'),
                description: scope.t('privacy.notices.description'),
                children: privacy!.notices.map((notice) {
                  final locale = scope.locale == 'ar' ? 'ar' : 'en';
                  return ExpansionTile(
                    key:
                        Key('authowl-privacy-notice-${notice.noticeVersionId}'),
                    tilePadding: EdgeInsets.zero,
                    title: Text(notice.title[locale] ?? ''),
                    children: <Widget>[
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: Text(notice.body[locale] ?? ''),
                      ),
                    ],
                  );
                }).toList(growable: false),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PrivacyCard extends StatelessWidget {
  const _PrivacyCard({
    required this.title,
    required this.description,
    required this.children,
  });

  final String title;
  final String description;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerLowest,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(14),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              description,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                    height: 1.4,
                  ),
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

/// The rights the server says it accepts, in the enum's own order.
///
/// A null list means the server cannot tell us, so everything is offered - the
/// behaviour before the field existed. Offering a right the server refuses is
/// what put seven failing buttons in front of end users on the web portal.
@visibleForTesting
List<AuthOwlPrivacyRight> offeredRightsFor(AuthOwlPrivacyConfig? privacy) {
  final advertised = privacy?.availableRightTypes;
  if (advertised == null) return AuthOwlPrivacyRight.values;
  return AuthOwlPrivacyRight.values
      .where((right) => advertised.contains(_rightWire(right)))
      .toList(growable: false);
}

String _rightWire(AuthOwlPrivacyRight right) => switch (right) {
      AuthOwlPrivacyRight.consentWithdrawal => 'consent_withdrawal',
      _ => right.name,
    };

String _rightKey(AuthOwlPrivacyRight right) => switch (right) {
      AuthOwlPrivacyRight.access => 'privacy.right.access',
      AuthOwlPrivacyRight.correction => 'privacy.right.correction',
      AuthOwlPrivacyRight.portability => 'privacy.right.portability',
      AuthOwlPrivacyRight.erasure => 'privacy.right.erasure',
      AuthOwlPrivacyRight.restriction => 'privacy.right.restriction',
      AuthOwlPrivacyRight.objection => 'privacy.right.objection',
      AuthOwlPrivacyRight.consentWithdrawal =>
        'privacy.right.consentWithdrawal',
    };

String _stateKey(AuthOwlPrivacyRequestState state) => switch (state) {
      AuthOwlPrivacyRequestState.received => 'privacy.state.received',
      AuthOwlPrivacyRequestState.identityPending =>
        'privacy.state.identityPending',
      AuthOwlPrivacyRequestState.inProgress => 'privacy.state.inProgress',
      AuthOwlPrivacyRequestState.restricted => 'privacy.state.restricted',
      AuthOwlPrivacyRequestState.completed => 'privacy.state.completed',
      AuthOwlPrivacyRequestState.denied => 'privacy.state.denied',
      AuthOwlPrivacyRequestState.withdrawn => 'privacy.state.withdrawn',
    };
