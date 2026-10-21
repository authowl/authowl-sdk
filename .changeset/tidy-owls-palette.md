---
"@authowl/react": major
---

Generate one scoped token stylesheet with product brands, inline SSR variables,
and typed appearance.elements classes. Theme supports light, dark, system and
inherit. The default silently changes from light to inherit, following a host
.dark class; set appearance.theme to light to retain the previous default.

Keep dual ao-/ba- classes and legacy variable reads for migration, plus inline
--ba-primary. Deprecate primaryColor in favour of variables.colorPrimary. Legacy
compatibility is scheduled for removal in 2.0. Fix error text contrast using the
danger token. Geometry defaults are unchanged. Tailwind hosts should import
@authowl/react/styles.css in layer(components). See docs/react-appearance-migration.md.
