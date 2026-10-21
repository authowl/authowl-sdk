import { safeCssValue } from './css-values';
import type { PublicConfig } from '@authowl/core';
import type { Elements } from './elements';
import { brandRampVars, deriveBrandRamp, parseColor, readableForeground } from './brand';

const VARIABLE_TOKENS = {
  colorBackground: 'surface', colorText: 'fg', colorTextSecondary: 'fg-muted',
  colorInputBackground: 'input-background', colorInputText: 'input-text',
  colorDanger: 'danger', colorSuccess: 'success', colorBorder: 'line-strong',
  borderRadius: 'border-radius', controlHeight: 'control-height', fontFamily: 'font-family',
} as const;
export type AppearanceVariables = Partial<Record<keyof typeof VARIABLE_TOKENS | 'colorPrimary', string>>;
export type Appearance = {
  theme?: 'light' | 'dark' | 'system' | 'inherit';
  brand?: 'authowl' | 'billow' | 'hitsend';
  variables?: AppearanceVariables;
  elements?: Elements;
  /** Host-controlled layout options. Omitted options preserve the inline layout. */
  layout?: {
    /**
     * Dock SignIn, SignUp and their card steps to the viewport bottom at widths
     * of 480px or less, with a decorative handle, safe-area padding and internal
     * scrolling. Defaults to false. Has no effect above 480px or on UserProfileModal.
     * Embedded invitation forms (AcceptApplicationInvitation,
     * AcceptOrganizationInvitation) always stay inline.
     */
    mobileSheet?: boolean;
  };
  /** @deprecated Use variables.colorPrimary. Removed in 2.0. */
  primaryColor?: string;
};
export type ResolvedAppearance = {
  theme: NonNullable<Appearance['theme']>;
  brand: NonNullable<Appearance['brand']>;
  primaryColor?: string;
  style: Record<string, string>;
};

/** Pure and synchronous: theme and overrides are in the server's first HTML. */
export function resolveAppearance(appearance: Appearance | undefined, config: PublicConfig | null): ResolvedAppearance {
  const theme = appearance?.theme ?? config?.branding?.theme ?? 'inherit';
  const brand = appearance?.brand ?? 'authowl';
  const candidate = appearance?.variables?.colorPrimary ?? appearance?.primaryColor ??
    (appearance?.brand ? undefined : config?.branding?.primaryColor);
  const primaryColor = candidate !== undefined && safeCssValue('colorPrimary', candidate, 'color') ? candidate : undefined;
  const style: Record<string, string> = {};
  for (const [name, token] of Object.entries(VARIABLE_TOKENS)) {
    const value = appearance?.variables?.[name as keyof typeof VARIABLE_TOKENS];
    if (value !== undefined && safeCssValue(name, value, name.startsWith('color') ? 'color' : name === 'fontFamily' ? 'font' : 'length')) style[`--ao-${token}`] = value;
  }
  if (primaryColor) {
    const solid = parseColor(primaryColor)!;
    const fill = /^#[0-9a-f]{6}$/i.test(primaryColor) ? primaryColor : solid;
    style['--ba-primary'] = fill;
    style['--ao-primary'] = fill;
    const ramp = deriveBrandRamp(solid);
    Object.assign(style, brandRampVars(ramp));
    for (const [scheme, suffix] of [['light', 'l'], ['dark', 'd']] as const) {
      style[`--ba-rt-solid-hover-${suffix}`] = ramp[scheme].accentSolidHover;
      style[`--ba-rt-solid-active-${suffix}`] = ramp[scheme].accentSolidActive;
      style[`--ba-rt-accent-${suffix}`] = ramp[scheme].accent;
      // Contrast follows the emitted state fill, after gamut mapping and
      // quantization. A label that passes on the resting fill may fail on hover.
      style[`--ao-${scheme}-on-brand-hover`] = readableForeground(ramp[scheme].accentSolidHover);
      style[`--ao-${scheme}-on-brand-active`] = readableForeground(ramp[scheme].accentSolidActive);
    }
    style['--ba-rt-accent-fg'] = ramp.light.accentFg;
  }
  return { theme, brand, primaryColor, style };
}
