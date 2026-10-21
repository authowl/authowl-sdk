import type { PublicConfig } from '@authowl/core';
import type { Elements } from './elements';
import { brandRampVars, deriveBrandRamp, normalizeHex } from './brand';

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
  const primaryColor = appearance?.variables?.colorPrimary ?? appearance?.primaryColor ??
    (appearance?.brand ? undefined : config?.branding?.primaryColor);
  const style: Record<string, string> = {};
  for (const [name, token] of Object.entries(VARIABLE_TOKENS)) {
    const value = appearance?.variables?.[name as keyof typeof VARIABLE_TOKENS];
    if (value !== undefined) style[`--ao-${token}`] = value;
  }
  if (appearance?.variables?.controlHeight) style['--ao-control-box-sizing'] = 'border-box';
  if (primaryColor) {
    style['--ba-primary'] = primaryColor;
    style['--ao-primary'] = primaryColor;
    const hex = normalizeHex(primaryColor);
    if (hex) Object.assign(style, brandRampVars(deriveBrandRamp(hex)));
    else for (const scheme of ['light', 'dark']) {
      style[`--ao-${scheme}-brand`] = primaryColor;
      style[`--ao-${scheme}-brand-hover`] = `color-mix(in oklab, ${primaryColor} 90%, ${scheme === 'light' ? 'black' : 'white'})`;
      style[`--ao-${scheme}-brand-text`] = `color-mix(in oklab, ${primaryColor} ${scheme === 'light' ? '65%' : '80%'}, ${scheme === 'light' ? 'black' : 'white'})`;
    }
  }
  return { theme, brand, primaryColor, style };
}
