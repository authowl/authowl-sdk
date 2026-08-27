/// Drop-in email/password sign-in screen.
library;

import 'package:flutter/material.dart';

import '../../authowl_client.dart'
    show AuthOwlChallengeAction, AuthOwlChallengeTokenProvider;
import '../provider.dart';
import 'primitives.dart';

/// Email and password sign-in.
///
/// Social sign-in is intentionally not rendered here: it needs a provider ID
/// token from a native SDK the app configures itself, so a button that cannot
/// work without that wiring would be a broken affordance.
class AuthOwlSignIn extends StatefulWidget {
  const AuthOwlSignIn({
    this.onSignedIn,
    this.onSecondFactorRequired,
    this.onMfaEnrollmentRequired,
    this.onForgotPassword,
    this.challengeTokenProvider,
    super.key,
  });

  /// Called once a session exists.
  final VoidCallback? onSignedIn;

  /// Called when valid credentials must be followed by a second factor.
  final VoidCallback? onSecondFactorRequired;

  /// Called when the project holds this session at required MFA enrolment.
  final VoidCallback? onMfaEnrollmentRequired;

  /// Rendered as a link under the form, when provided.
  final VoidCallback? onForgotPassword;

  /// Called for each submit to mint a fresh, single-use challenge token.
  final AuthOwlChallengeTokenProvider? challengeTokenProvider;

  @override
  State<AuthOwlSignIn> createState() => _AuthOwlSignInState();
}

class _AuthOwlSignInState extends State<AuthOwlSignIn> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // TextEditingController changes do not rebuild the widget on their own, so
    // without these the submit button would never leave its disabled state.
    _email.addListener(_onFieldChanged);
    _password.addListener(_onFieldChanged);
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _email.removeListener(_onFieldChanged);
    _password.removeListener(_onFieldChanged);
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _email.text.trim().isNotEmpty && _password.text.isNotEmpty && !_busy;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    final scope = AuthOwlProvider.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });

    String? challengeToken;
    try {
      challengeToken = await widget.challengeTokenProvider
          ?.call(AuthOwlChallengeAction.signIn);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = scope.t('signIn.error.failed');
      });
      return;
    }
    if (!mounted) return;

    final result = await scope.client.signInWithEmail(
      // The email is trimmed; the password never is - trailing spaces are
      // legitimate characters and silently dropping them locks people out.
      email: _email.text.trim(),
      password: _password.text,
      challengeToken: challengeToken,
    );
    if (!mounted) return;

    setState(() => _busy = false);
    if (!result.isSuccess) {
      setState(() =>
          _error = scope.errorMessage(result.error, 'signIn.error.failed'));
      return;
    }
    // A two-factor challenge is neither a failure nor a session. Reporting
    // success would let an app navigate straight past the second factor.
    final data = result.data;
    if (data is Map && data['twoFactorRedirect'] == true) {
      widget.onSecondFactorRequired?.call();
      return;
    }
    final session = scope.client.session.state;
    if (session.session?.pendingMfaEnrollment == true) {
      widget.onMfaEnrollmentRequired?.call();
      return;
    }
    if (session.isSignedIn) {
      widget.onSignedIn?.call();
      return;
    }
    setState(() => _error = scope.t('signIn.error.failed'));
  }

  @override
  Widget build(BuildContext context) {
    final scope = AuthOwlProvider.of(context);
    if (scope.publicConfigState == AuthOwlPublicConfigState.loading ||
        (scope.publicConfig != null && !scope.publicConfig!.passwordSignIn)) {
      return const SizedBox.shrink();
    }
    return AuthOwlColumn(
      key: const Key('authowl-signin'),
      children: <Widget>[
        Text(scope.t('signIn.title'),
            style: Theme.of(context).textTheme.headlineSmall),
        AuthOwlField(
          key: const Key('authowl-signin-email'),
          label: scope.t('common.emailLabel'),
          controller: _email,
          enabled: !_busy,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const <String>[AutofillHints.username],
        ),
        AuthOwlField(
          key: const Key('authowl-signin-password'),
          label: scope.t('common.passwordLabel'),
          controller: _password,
          obscure: true,
          enabled: !_busy,
          autofillHints: const <String>[AutofillHints.password],
          onSubmitted: _submit,
        ),
        AuthOwlFormError(message: _error),
        AuthOwlSubmitButton(
          key: const Key('authowl-signin-submit'),
          label: scope.t('signIn.submit'),
          busyLabel: scope.t('signIn.submitPending'),
          onPressed: _submit,
          busy: _busy,
          enabled: _canSubmit,
        ),
        if (widget.onForgotPassword != null)
          TextButton(
            key: const Key('authowl-signin-forgot'),
            onPressed: widget.onForgotPassword,
            child: Text(scope.t('signIn.forgotLink')),
          ),
      ],
    );
  }
}
