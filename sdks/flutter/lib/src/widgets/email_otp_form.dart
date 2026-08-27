/// Passwordless sign-in with an emailed one-time code.
library;

import 'package:flutter/material.dart';

import '../../authowl_client.dart'
    show AuthOwlChallengeAction, AuthOwlChallengeTokenProvider;
import '../provider.dart';
import 'primitives.dart';

/// Request a code, then verify it.
///
/// Both stages live in one widget because the code stage is meaningless without
/// the address entered in the first, and splitting them across routes loses
/// that context on a back navigation.
class AuthOwlEmailOtpForm extends StatefulWidget {
  const AuthOwlEmailOtpForm({
    this.onSignedIn,
    this.challengeTokenProvider,
    super.key,
  });

  final VoidCallback? onSignedIn;

  /// Called before requesting a code to mint a fresh challenge token.
  final AuthOwlChallengeTokenProvider? challengeTokenProvider;

  @override
  State<AuthOwlEmailOtpForm> createState() => _AuthOwlEmailOtpFormState();
}

class _AuthOwlEmailOtpFormState extends State<AuthOwlEmailOtpForm> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _code = TextEditingController();
  bool _codeStage = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _email.addListener(_onFieldChanged);
    _code.addListener(_onFieldChanged);
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _email
      ..removeListener(_onFieldChanged)
      ..dispose();
    _code
      ..removeListener(_onFieldChanged)
      ..dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    if (_busy || _email.text.trim().isEmpty) return;
    final scope = AuthOwlProvider.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });

    String? challengeToken;
    try {
      challengeToken = await widget.challengeTokenProvider
          ?.call(AuthOwlChallengeAction.passwordless);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = scope.t('emailOtp.error.sendFailed');
      });
      return;
    }
    if (!mounted) return;

    final result = await scope.client.sendEmailOtp(
      email: _email.text.trim(),
      challengeToken: challengeToken,
    );
    if (!mounted) return;
    setState(() => _busy = false);

    if (!result.isSuccess) {
      setState(() => _error =
          scope.errorMessage(result.error, 'emailOtp.error.sendFailed'));
      return;
    }
    setState(() => _codeStage = true);
  }

  Future<void> _verifyCode() async {
    if (_busy || _code.text.trim().isEmpty) return;
    final scope = AuthOwlProvider.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });

    final result = await scope.client.signInWithEmailOtp(
      email: _email.text.trim(),
      otp: _code.text.trim(),
    );
    if (!mounted) return;
    setState(() => _busy = false);

    if (!result.isSuccess) {
      setState(() => _error =
          scope.errorMessage(result.error, 'emailOtp.error.invalidCode'));
      return;
    }
    if (scope.client.session.state.isSignedIn) {
      widget.onSignedIn?.call();
    } else {
      setState(() => _error = scope.t('emailOtp.error.invalidCode'));
    }
  }

  void _changeEmail() {
    // Drop the code too: it was minted for the old address and could only ever
    // fail against a new one.
    setState(() {
      _codeStage = false;
      _error = null;
      _code.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final scope = AuthOwlProvider.of(context);
    if (scope.publicConfigState == AuthOwlPublicConfigState.loading ||
        (scope.publicConfig != null &&
            !scope.publicConfig!.enabledMethods.contains('email_otp'))) {
      return const SizedBox.shrink();
    }
    if (!_codeStage) {
      return AuthOwlColumn(
        key: const Key('authowl-emailotp'),
        children: <Widget>[
          AuthOwlField(
            key: const Key('authowl-emailotp-email'),
            label: scope.t('common.emailLabel'),
            controller: _email,
            enabled: !_busy,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const <String>[AutofillHints.username],
            onSubmitted: _requestCode,
          ),
          AuthOwlFormError(message: _error),
          AuthOwlSubmitButton(
            key: const Key('authowl-emailotp-request'),
            label: scope.t('emailOtp.requestSubmit'),
            busyLabel: scope.t('common.sending'),
            onPressed: _requestCode,
            busy: _busy,
            enabled: _email.text.trim().isNotEmpty,
          ),
        ],
      );
    }

    return AuthOwlColumn(
      key: const Key('authowl-emailotp'),
      children: <Widget>[
        AuthOwlField(
          key: const Key('authowl-emailotp-code'),
          label: scope.t('emailOtp.codeLabel',
              <String, Object?>{'email': _email.text.trim()}),
          controller: _code,
          enabled: !_busy,
          keyboardType: TextInputType.number,
          autofillHints: const <String>[AutofillHints.oneTimeCode],
          onSubmitted: _verifyCode,
        ),
        AuthOwlFormError(message: _error),
        AuthOwlSubmitButton(
          key: const Key('authowl-emailotp-verify'),
          label: scope.t('emailOtp.verifySubmit'),
          busyLabel: scope.t('common.verifying'),
          onPressed: _verifyCode,
          busy: _busy,
          enabled: _code.text.trim().isNotEmpty,
        ),
        TextButton(
          key: const Key('authowl-emailotp-change'),
          onPressed: _changeEmail,
          child: Text(scope.t('emailOtp.changeEmail')),
        ),
      ],
    );
  }
}
