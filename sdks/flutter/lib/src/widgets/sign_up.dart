/// Drop-in email/password sign-up screen.
library;

import '../../authowl_client.dart' show AuthOwlLegalConfig;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../provider.dart';
import '../theme.dart';
import 'primitives.dart';

/// Create an account with an email address and password.
class AuthOwlSignUp extends StatefulWidget {
  const AuthOwlSignUp({this.onSignedUp, super.key});

  /// Called on success with whether a SESSION was established.
  ///
  /// Projects that require email verification create none, and "check your
  /// email" is a different screen from "you are in".
  final void Function({required bool sessionCreated})? onSignedUp;

  @override
  State<AuthOwlSignUp> createState() => _AuthOwlSignUpState();
}

class _AuthOwlSignUpState extends State<AuthOwlSignUp> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;
  bool _acceptedConsent = false;
  int? _consentVersion;

  @override
  void initState() {
    super.initState();
    for (final controller in <TextEditingController>[
      _name,
      _email,
      _password
    ]) {
      controller.addListener(_onFieldChanged);
    }
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final version = AuthOwlProvider.of(context).publicConfig?.legal.version;
    if (version != _consentVersion) {
      _consentVersion = version;
      _acceptedConsent = false;
    }
  }

  @override
  void dispose() {
    for (final controller in <TextEditingController>[
      _name,
      _email,
      _password
    ]) {
      controller
        ..removeListener(_onFieldChanged)
        ..dispose();
    }
    super.dispose();
  }

  // The server requires a display name, so the button stays closed without one
  // rather than failing on the wire for a reason the user cannot act on.
  bool _canSubmit(AuthOwlScope scope) {
    final config = scope.publicConfig;
    final minLength = config?.passwordMinLength ?? 8;
    final maxLength = config?.passwordMaxLength ?? 128;
    final fieldsValid = _name.text.trim().isNotEmpty &&
        _email.text.trim().isNotEmpty &&
        _password.text.length >= minLength &&
        _password.text.length <= maxLength;
    final consentValid = !(config?.legal.required ?? false) || _acceptedConsent;
    return fieldsValid && consentValid && !_busy;
  }

  Future<void> _submit() async {
    final scope = AuthOwlProvider.of(context);
    if (!_canSubmit(scope)) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    final result = await scope.client.signUpWithEmail(
      email: _email.text.trim(),
      password: _password.text,
      name: _name.text.trim(),
      consentVersion: scope.publicConfig?.legal.required == true
          ? scope.publicConfig!.legal.version
          : null,
    );
    if (!mounted) return;

    setState(() => _busy = false);
    if (!result.isSuccess) {
      setState(() =>
          _error = scope.errorMessage(result.error, 'signUp.error.failed'));
      return;
    }
    final data = result.data;
    final created = data is Map && data['sessionCreated'] == true;
    widget.onSignedUp?.call(sessionCreated: created);
  }

  @override
  Widget build(BuildContext context) {
    final scope = AuthOwlProvider.of(context);
    final config = scope.publicConfig;
    if (scope.publicConfigState == AuthOwlPublicConfigState.loading ||
        (config != null && !config.passwordSignUp)) {
      return const SizedBox.shrink();
    }
    final legal = config?.legal;
    return AuthOwlColumn(
      key: const Key('authowl-signup'),
      children: <Widget>[
        Text(scope.t('signUp.title'),
            style: Theme.of(context).textTheme.headlineSmall),
        AuthOwlField(
          key: const Key('authowl-signup-name'),
          label: scope.t('signUp.nameLabel'),
          controller: _name,
          enabled: !_busy,
          autofillHints: const <String>[AutofillHints.name],
        ),
        AuthOwlField(
          key: const Key('authowl-signup-email'),
          label: scope.t('common.emailLabel'),
          controller: _email,
          enabled: !_busy,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const <String>[AutofillHints.username],
        ),
        AuthOwlField(
          key: const Key('authowl-signup-password'),
          label: scope.t('common.passwordLabel'),
          controller: _password,
          obscure: true,
          enabled: !_busy,
          autofillHints: const <String>[AutofillHints.newPassword],
          maxLength: config?.passwordMaxLength ?? 128,
          onSubmitted: _submit,
        ),
        if (legal?.required == true)
          _LegalConsentRow(
            key: const Key('authowl-signup-consent'),
            scope: scope,
            legal: legal!,
            accepted: _acceptedConsent,
            enabled: !_busy,
            onChanged: (accepted) =>
                setState(() => _acceptedConsent = accepted),
          ),
        AuthOwlFormError(message: _error),
        AuthOwlSubmitButton(
          key: const Key('authowl-signup-submit'),
          label: scope.t('signUp.submit'),
          busyLabel: scope.t('signUp.submitPending'),
          onPressed: _submit,
          busy: _busy,
          enabled: _canSubmit(scope),
        ),
      ],
    );
  }
}

class _LegalConsentRow extends StatelessWidget {
  const _LegalConsentRow({
    required this.scope,
    required this.legal,
    required this.accepted,
    required this.enabled,
    required this.onChanged,
    super.key,
  });

  final AuthOwlScope scope;
  final AuthOwlLegalConfig legal;
  final bool accepted;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final primaryColor = scope.primaryColor;
    final textStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: colorScheme.onSurface,
          height: 1.4,
        );
    final template = scope.t('signUp.consentLabel');
    const marker = '{links}';
    final markerIndex = template.indexOf(marker);
    final prefix =
        markerIndex == -1 ? template : template.substring(0, markerIndex);
    final suffix = markerIndex == -1
        ? ''
        : template.substring(markerIndex + marker.length);
    final termsUrl = legal.termsUrl;
    final privacyUrl = legal.privacyUrl;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SizedBox(
          width: 24,
          height: 19,
          child: Checkbox(
            key: const Key('authowl-signup-consent-control'),
            value: accepted,
            onChanged: enabled ? (value) => onChanged(value == true) : null,
            activeColor: primaryColor,
            checkColor: authOwlForegroundFor(primaryColor),
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Text(prefix, style: textStyle),
              if (termsUrl != null)
                _ConsentLink(
                  label: scope.t('consent.termsOfService'),
                  url: termsUrl,
                  style: textStyle,
                ),
              if (termsUrl != null && privacyUrl != null)
                Text(scope.t('consent.docJoiner'), style: textStyle),
              if (privacyUrl != null)
                _ConsentLink(
                  label: scope.t('consent.privacyPolicy'),
                  url: privacyUrl,
                  style: textStyle,
                ),
              Text(suffix, style: textStyle),
            ],
          ),
        ),
      ],
    );
  }
}

class _ConsentLink extends StatelessWidget {
  const _ConsentLink({
    required this.label,
    required this.url,
    required this.style,
  });

  final String label;
  final String url;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final primaryColor = AuthOwlProvider.of(context).primaryColor;
    return Semantics(
      link: true,
      child: InkWell(
        onTap: () => launchUrl(
          Uri.parse(url),
          mode: LaunchMode.externalApplication,
        ),
        child: Text(
          label,
          style: style?.copyWith(
            color: authOwlReadableAccent(primaryColor, colorScheme.surface),
            decoration: TextDecoration.underline,
            decorationColor:
                authOwlReadableAccent(primaryColor, colorScheme.surface),
          ),
        ),
      ),
    );
  }
}
