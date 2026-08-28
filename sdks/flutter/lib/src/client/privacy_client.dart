/// Typed consent and data-rights APIs for signed-in users.
library;

import 'idempotency.dart';
import 'transport.dart';

enum AuthOwlPrivacyLocale { en, ar }

enum AuthOwlConsentState { granted, refused, withdrawn }

enum AuthOwlPrivacyRight {
  access,
  correction,
  portability,
  erasure,
  restriction,
  objection,
  consentWithdrawal,
}

enum AuthOwlPrivacyRequestState {
  received,
  identityPending,
  inProgress,
  restricted,
  completed,
  denied,
  withdrawn,
}

class AuthOwlConsentPreference {
  const AuthOwlConsentPreference({
    required this.purposeId,
    required this.purposeVersionId,
    required this.code,
    required this.state,
    required this.updatedAt,
    required this.decidedAt,
  });

  final String purposeId;
  final String purposeVersionId;
  final String code;
  final AuthOwlConsentState? state;
  final DateTime? updatedAt;
  final DateTime? decidedAt;
}

class AuthOwlPrivacyRequest {
  const AuthOwlPrivacyRequest({
    required this.id,
    required this.rightType,
    required this.state,
    required this.locale,
    required this.receivedAt,
    required this.acknowledgedAt,
    required this.fulfilmentDeadline,
    required this.completedAt,
  });

  final String id;
  final AuthOwlPrivacyRight rightType;
  final AuthOwlPrivacyRequestState state;
  final AuthOwlPrivacyLocale locale;
  final DateTime receivedAt;
  final DateTime? acknowledgedAt;
  final DateTime fulfilmentDeadline;
  final DateTime? completedAt;
}

class AuthOwlPrivacyClient {
  const AuthOwlPrivacyClient(this._transport);

  final AuthOwlTransport _transport;

  Future<AuthResult<List<AuthOwlConsentPreference>>>
      listConsentPreferences() async {
    final result = await _transport.sendProject('/privacy/consent-decisions');
    if (result.error != null) return AuthResult(error: result.error);
    try {
      final body = _objectMap(result.data);
      final rows = body['preferences'];
      if (rows is! List) throw const FormatException();
      return AuthResult(
        data: rows.map(_consentPreference).toList(growable: false),
      );
    } on FormatException {
      return const AuthResult(error: _invalidPrivacyResponse);
    }
  }

  Future<AuthResult<AuthOwlConsentState>> recordConsent({
    required String purposeCode,
    required String purposeVersionId,
    required String noticeVersionId,
    required AuthOwlConsentState decision,
    required AuthOwlPrivacyLocale locale,
    String? correlationId,
  }) async {
    final result = await _transport.sendProject(
      '/privacy/consent-decisions',
      method: 'POST',
      body: <String, Object?>{
        'purposeCode': purposeCode,
        'purposeVersionId': purposeVersionId,
        'noticeVersionId': noticeVersionId,
        'decision': _consentStateWire(decision),
        'locale': locale.name,
        'correlationId': correlationId ?? createAuthOwlIdempotencyKey(),
      },
    );
    if (result.error != null) return AuthResult(error: result.error);
    try {
      final body = _objectMap(result.data);
      if (body['recorded'] != true) throw const FormatException();
      return AuthResult(data: _consentState(body['decision']));
    } on FormatException {
      return const AuthResult(error: _invalidPrivacyResponse);
    }
  }

  Future<AuthResult<List<AuthOwlPrivacyRequest>>> listRightsRequests() async {
    final result = await _transport.sendProject('/privacy/rights');
    if (result.error != null) return AuthResult(error: result.error);
    try {
      final body = _objectMap(result.data);
      final rows = body['requests'];
      if (rows is! List) throw const FormatException();
      return AuthResult(
          data: rows.map(_privacyRequest).toList(growable: false));
    } on FormatException {
      return const AuthResult(error: _invalidPrivacyResponse);
    }
  }

  Future<AuthResult<AuthOwlPrivacyRequest>> createRightsRequest({
    required AuthOwlPrivacyRight rightType,
    required AuthOwlPrivacyLocale locale,
  }) async {
    final result = await _transport.sendProject(
      '/privacy/rights',
      method: 'POST',
      body: <String, Object?>{
        'rightType': _privacyRightWire(rightType),
        'locale': locale.name,
      },
    );
    if (result.error != null) return AuthResult(error: result.error);
    try {
      return AuthResult(
        data: _privacyRequest(_objectMap(result.data)['request']),
      );
    } on FormatException {
      return const AuthResult(error: _invalidPrivacyResponse);
    }
  }
}

const _invalidPrivacyResponse = AuthError(
  code: 'INVALID_RESPONSE',
  message: 'The server returned an invalid privacy response.',
);

AuthOwlConsentPreference _consentPreference(Object? value) {
  final row = _objectMap(value);
  return AuthOwlConsentPreference(
    purposeId: _string(row['purposeId']),
    purposeVersionId: _string(row['purposeVersionId']),
    code: _string(row['code']),
    state: row['state'] == null ? null : _consentState(row['state']),
    updatedAt: _nullableDate(row['updatedAt']),
    decidedAt: _nullableDate(row['decidedAt']),
  );
}

AuthOwlPrivacyRequest _privacyRequest(Object? value) {
  final row = _objectMap(value);
  return AuthOwlPrivacyRequest(
    id: _string(row['id']),
    rightType: _privacyRight(row['rightType']),
    state: _requestState(row['state']),
    locale: _privacyLocale(row['locale']),
    receivedAt: _date(row['receivedAt']),
    acknowledgedAt: _nullableDate(row['acknowledgedAt']),
    fulfilmentDeadline: _date(row['fulfilmentDeadline']),
    completedAt: _nullableDate(row['completedAt']),
  );
}

Map<String, Object?> _objectMap(Object? value) {
  if (value is! Map) throw const FormatException();
  return value.map((key, item) => MapEntry(key.toString(), item));
}

String _string(Object? value) {
  if (value is! String || value.isEmpty) throw const FormatException();
  return value;
}

DateTime _date(Object? value) {
  if (value is! String) throw const FormatException();
  final date = DateTime.tryParse(value);
  if (date == null) throw const FormatException();
  return date;
}

DateTime? _nullableDate(Object? value) => value == null ? null : _date(value);

AuthOwlConsentState _consentState(Object? value) => switch (value) {
      'granted' => AuthOwlConsentState.granted,
      'refused' => AuthOwlConsentState.refused,
      'withdrawn' => AuthOwlConsentState.withdrawn,
      _ => throw const FormatException(),
    };

String _consentStateWire(AuthOwlConsentState value) => value.name;

AuthOwlPrivacyLocale _privacyLocale(Object? value) => switch (value) {
      'en' => AuthOwlPrivacyLocale.en,
      'ar' => AuthOwlPrivacyLocale.ar,
      _ => throw const FormatException(),
    };

AuthOwlPrivacyRight _privacyRight(Object? value) => switch (value) {
      'access' => AuthOwlPrivacyRight.access,
      'correction' => AuthOwlPrivacyRight.correction,
      'portability' => AuthOwlPrivacyRight.portability,
      'erasure' => AuthOwlPrivacyRight.erasure,
      'restriction' => AuthOwlPrivacyRight.restriction,
      'objection' => AuthOwlPrivacyRight.objection,
      'consent_withdrawal' => AuthOwlPrivacyRight.consentWithdrawal,
      _ => throw const FormatException(),
    };

String _privacyRightWire(AuthOwlPrivacyRight value) => switch (value) {
      AuthOwlPrivacyRight.consentWithdrawal => 'consent_withdrawal',
      _ => value.name,
    };

AuthOwlPrivacyRequestState _requestState(Object? value) => switch (value) {
      'received' => AuthOwlPrivacyRequestState.received,
      'identity_pending' => AuthOwlPrivacyRequestState.identityPending,
      'in_progress' => AuthOwlPrivacyRequestState.inProgress,
      'restricted' => AuthOwlPrivacyRequestState.restricted,
      'completed' => AuthOwlPrivacyRequestState.completed,
      'denied' => AuthOwlPrivacyRequestState.denied,
      'withdrawn' => AuthOwlPrivacyRequestState.withdrawn,
      _ => throw const FormatException(),
    };
