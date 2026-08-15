/// AuthOwl's default Flutter color contract.
library;

import 'package:flutter/material.dart';

/// The approved AuthOwl gold used when neither the project nor the app provides
/// a different primary color.
const authOwlBrandColor = Color(0xfff5b84c);

/// The approved foreground on AuthOwl gold.
const authOwlBrandForeground = Color(0xff241703);

/// Decode the dashboard's public `#rrggbb` brand value without allowing a bad
/// or legacy response to break the widget tree.
Color? parseAuthOwlColor(String? value) {
  if (value == null || !RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(value)) {
    return null;
  }
  return Color(0xff000000 | int.parse(value.substring(1), radix: 16));
}

Color authOwlForegroundFor(Color background) {
  final darkContrast = _contrast(background, authOwlBrandForeground);
  final lightContrast = _contrast(background, Colors.white);
  return darkContrast >= lightContrast ? authOwlBrandForeground : Colors.white;
}

/// Keep inline links recognizably on-hue while solving AA contrast against the
/// current surface. The filled controls still use the exact project color.
Color authOwlReadableAccent(Color primary, Color surface) {
  if (_contrast(primary, surface) >= 4.5) return primary;
  final hsl = HSLColor.fromColor(primary);
  final darkSurface = surface.computeLuminance() < 0.5;
  for (var step = 1; step <= 50; step += 1) {
    final lightness = darkSurface
        ? (hsl.lightness + step * 0.02).clamp(0.0, 1.0)
        : (hsl.lightness - step * 0.02).clamp(0.0, 1.0);
    final candidate = hsl.withLightness(lightness).toColor();
    if (_contrast(candidate, surface) >= 4.5) return candidate;
  }
  return darkSurface ? Colors.white : authOwlBrandForeground;
}

ThemeData authOwlThemeData(ThemeData base, Color primaryColor) => base.copyWith(
      colorScheme: base.colorScheme.copyWith(
        primary: primaryColor,
        onPrimary: authOwlForegroundFor(primaryColor),
      ),
    );

double _contrast(Color first, Color second) {
  final lighter = first.computeLuminance() > second.computeLuminance()
      ? first.computeLuminance()
      : second.computeLuminance();
  final darker = first.computeLuminance() < second.computeLuminance()
      ? first.computeLuminance()
      : second.computeLuminance();
  return (lighter + 0.05) / (darker + 0.05);
}
