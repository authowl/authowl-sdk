/// Shared building blocks for the built-in auth screens.
library;

import 'package:flutter/material.dart';

import '../provider.dart';
import '../theme.dart';

/// A labelled text field.
class AuthOwlField extends StatelessWidget {
  const AuthOwlField({
    required this.label,
    required this.controller,
    this.obscure = false,
    this.enabled = true,
    this.keyboardType,
    this.autofillHints,
    this.onSubmitted,
    this.maxLength,
    super.key,
  });

  final String label;
  final TextEditingController controller;
  final bool obscure;
  final bool enabled;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final VoidCallback? onSubmitted;
  final int? maxLength;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscure,
      enabled: enabled,
      keyboardType: keyboardType,
      autofillHints: autofillHints,
      // Never autocapitalize or autocorrect a credential: an autocapitalized
      // email is a sign-in failure the user cannot see.
      textCapitalization: TextCapitalization.none,
      autocorrect: false,
      enableSuggestions: false,
      onSubmitted: onSubmitted == null ? null : (_) => onSubmitted!(),
      maxLength: maxLength,
      decoration:
          InputDecoration(labelText: label, border: const OutlineInputBorder()),
    );
  }
}

/// The primary action, with its own busy state.
class AuthOwlSubmitButton extends StatelessWidget {
  const AuthOwlSubmitButton({
    required this.label,
    required this.busyLabel,
    required this.onPressed,
    this.busy = false,
    this.enabled = true,
    super.key,
  });

  final String label;
  final String busyLabel;
  final VoidCallback onPressed;
  final bool busy;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final blocked = busy || !enabled;
    return Semantics(
      button: true,
      enabled: !blocked,
      child: FilledButton(
        onPressed: blocked ? null : onPressed,
        child: busy
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 8),
                  Text(busyLabel),
                ],
              )
            : Text(label),
      ),
    );
  }
}

/// An error message.
///
/// Announced politely so a screen reader reports a failed sign-in without
/// interrupting whatever the user is doing.
class AuthOwlFormError extends StatelessWidget {
  const AuthOwlFormError({required this.message, super.key});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final text = message;
    if (text == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Text(
        text,
        key: const Key('authowl-error'),
        style: TextStyle(color: Theme.of(context).colorScheme.error),
      ),
    );
  }
}

/// Vertical rhythm shared by the built-in screens.
class AuthOwlColumn extends StatelessWidget {
  const AuthOwlColumn({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scope = AuthOwlProvider.of(context);
    return Theme(
      data: authOwlThemeData(Theme.of(context), scope.primaryColor),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final child in children) ...<Widget>[
            child,
            const SizedBox(height: 12)
          ],
        ],
      ),
    );
  }
}
