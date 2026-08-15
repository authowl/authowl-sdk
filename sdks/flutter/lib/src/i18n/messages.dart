/// Message lookup over the generated catalogs.
library;

import 'catalog.g.dart';

/// The default locale, used when a requested one has no catalog.
const String fallbackLocale = 'en';

/// Locales that read right-to-left.
const Set<String> _rtlLocales = <String>{'ar'};

/// Whether [locale] has a catalog.
bool hasCatalog(String locale) => authOwlCatalogs.containsKey(locale);

/// The writing direction for [locale].
bool isRightToLeft(String locale) => _rtlLocales.contains(locale);

final RegExp _placeholder = RegExp(r'\{(\w+)\}');

/// Look up [key] in [locale] and interpolate `{name}` placeholders.
///
/// An unknown locale falls back to English rather than throwing: a missing
/// translation should degrade to readable text, not crash a sign-in screen.
/// An unknown KEY returns the key itself, which is visible in review and in
/// screenshots - far easier to spot than an empty label.
///
/// Placeholders with no matching parameter are left untouched, matching the
/// TypeScript `formatMessage` exactly, so the same catalog entry renders the
/// same way on every platform.
String formatMessage(String locale, String key, [Map<String, Object?>? params]) {
  final catalog = authOwlCatalogs[locale] ?? authOwlCatalogs[fallbackLocale]!;
  final message = catalog[key] ?? authOwlCatalogs[fallbackLocale]![key] ?? key;
  if (params == null || params.isEmpty) return message;
  return message.replaceAllMapped(_placeholder, (match) {
    final name = match.group(1)!;
    return params.containsKey(name) ? '${params[name]}' : match.group(0)!;
  });
}
