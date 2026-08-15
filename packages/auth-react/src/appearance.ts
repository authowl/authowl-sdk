import type { PublicConfig } from '@authowl/core';
import type { Appearance } from './provider';
import { brandRampVars, deriveBrandRamp, normalizeHex } from './brand';

export type ResolvedAppearance = {
  /** Requested theme; `'system'` is resolved to light/dark at render time. */
  theme: 'light' | 'dark' | 'system';
  primaryColor?: string;
  /** Inline CSS custom properties to scope the theme to the provider subtree. */
  style: Record<string, string>;
};

/**
 * Merge the explicit `appearance` prop over the project's fetched branding.
 * The prop always wins (a developer override beats the dashboard default);
 * fetched branding fills the gaps. Pure so it can be unit-tested without a DOM.
 *
 * When a brand color is resolved we emit `--ba-primary` plus the derived accent
 * ramp (both light + dark) as inline `--ba-rt-*` bridge vars (brand.ts), so the
 * button fill IS the brand, hover/active stay on-hue, and the label is
 * contrast-correct - in the SSR HTML, so the portal has the full brand at first
 * paint. When NO color is resolved we emit nothing: styles.css resolves the
 * default gold via its `var(--ba-primary, #F5B84C)` fallbacks, and a host
 * stylesheet that overrides `--ba-primary` on `.authowl-root` still wins.
 */
export function resolveAppearance(
  appearance: Appearance | undefined,
  config: PublicConfig | null,
): ResolvedAppearance {
  // Guard `branding` too, not just `config`: getPublicConfig casts the JSON with
  // no runtime validation, so a partial/legacy 200 without `branding` must not
  // crash the provider subtree during render.
  const theme = appearance?.theme ?? config?.branding?.theme ?? 'light';
  const primaryColor = appearance?.primaryColor ?? config?.branding?.primaryColor;

  const style: Record<string, string> = {};
  if (primaryColor) {
    // Pass the operator's color through verbatim (case preserved) so any host CSS
    // reading `--ba-primary` is unchanged.
    style['--ba-primary'] = primaryColor;
    const hex = normalizeHex(primaryColor);
    // Valid #rrggbb -> emit the full derived accent ramp as bridge vars. A non-hex
    // CSS color (e.g. a named color via the `appearance` prop) can't feed the ramp
    // math, so it falls through to the styles.css OKLab color-mix fallbacks, which
    // still derive a hue-true accent from `--ba-primary`.
    if (hex) Object.assign(style, brandRampVars(deriveBrandRamp(hex)));
  }

  return { theme, primaryColor, style };
}
