/**
 * Brand accent derivation (audit P1-5).
 *
 * The operator picks ONE brand color in the AuthOwl dashboard. This module turns
 * that single hex into the full set of accent tokens the drop-in forms and the
 * hosted account portal need - a filled button that IS the brand color, a
 * contrast-correct label on it, perceptually-darkened hover/active states that
 * stay ON hue, and a readable link/ring variant - WITHOUT the old
 * `color-mix(in srgb, primary 40%, black)` that collapsed chroma to mud
 * (gold #F5B84C -> #624A1E).
 *
 * The math is OKLab/OKLCH (Bjorn Ottosson) so lightness moves are perceptual and
 * hue+chroma are preserved; contrast is WCAG 2.x relative luminance. Everything
 * here is pure, synchronous, dependency-free and SSR-safe - `deriveBrandRamp`
 * runs during render on the server (the portal's ramp is in the SSR HTML, so the
 * brand is correct at first paint with zero client listeners).
 */

/** The single default brand color for BOTH the SDK forms and the hosted portal
 *  when an operator has not chosen one - the AuthOwl gold. Exported so the app
 *  (hosted portal) can default to the exact same value; one source of truth. */
export const DEFAULT_BRAND_COLOR = '#F5B84C';

/** #rrggbb (6-digit) only. Public-config is validated with this same shape on
 *  write, but it is cast without runtime validation on read, and an `appearance`
 *  prop is arbitrary - so callers must guard before trusting a value here. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isHex6(value: string | undefined | null): value is string {
  return typeof value === 'string' && HEX6.test(value);
}

/** Normalize `#RRGGBB` to lowercase; returns null for anything else (named
 *  colors, rgb()/hsl(), 3-digit hex, undefined). The ramp needs channel access,
 *  so non-hex inputs fall through to the caller's CSS fallback path. */
export function normalizeHex(value: string | undefined | null): string | null {
  return isHex6(value) ? value.toLowerCase() : null;
}

// --- sRGB <-> linear -------------------------------------------------------

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(l: number): number {
  return l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
}

type Rgb = { r: number; g: number; b: number }; // channels in [0, 1]

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to = (c: number) =>
    Math.round(clamp01(c) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// --- linear sRGB <-> OKLab/OKLCH ------------------------------------------

export type Oklch = { L: number; C: number; h: number }; // h in radians

function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  return { L, C: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

function oklchToLinearRgb({ L, C, h }: Oklch): Rgb {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

const GAMUT_EPS = 0.0001;

function inGamut({ r, g, b }: Rgb): boolean {
  return (
    r >= -GAMUT_EPS &&
    r <= 1 + GAMUT_EPS &&
    g >= -GAMUT_EPS &&
    g <= 1 + GAMUT_EPS &&
    b >= -GAMUT_EPS &&
    b <= 1 + GAMUT_EPS
  );
}

/**
 * Render an OKLCH color to `#rrggbb`, reducing chroma (hue + lightness kept) by
 * binary search until it fits the sRGB gamut. Preserving L and h and trimming
 * only C is what keeps darkened hover/active states on-brand instead of shifting
 * hue or clipping to a flat channel.
 */
/** #rrggbb -> OKLCH. Exported for tests (kept out of the package index). */
export function hexToOklch(hex: string): Oklch {
  return rgbToOklch(hexToRgb(hex));
}

/** OKLCH hue in degrees [0, 360). Exported for hue-preservation tests. */
export function hueDegrees({ h }: Oklch): number {
  const d = (h * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

export function oklchToHex(color: Oklch): string {
  const linear = oklchToLinearRgb(color);
  if (inGamut(linear)) return rgbToHex(linearToGamma(linear));

  let lo = 0;
  let hi = color.C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearRgb({ ...color, C: mid }))) lo = mid;
    else hi = mid;
  }
  return rgbToHex(linearToGamma(oklchToLinearRgb({ ...color, C: lo })));
}

function linearToGamma({ r, g, b }: Rgb): Rgb {
  return {
    r: linearToSrgb(clamp01(r)),
    g: linearToSrgb(clamp01(g)),
    b: linearToSrgb(clamp01(b)),
  };
}

// --- WCAG contrast ---------------------------------------------------------

function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors, in [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const NEAR_BLACK = '#18181b'; // matches --ba-fg (light) / --ba-surface (dark)
const WHITE = '#ffffff';
const AA_TEXT = 4.5;

const PURE_BLACK = '#000000';

/** The most readable label color for a solid brand fill, guaranteed >= AA (4.5:1).
 *  Prefers white vs near-black (`#18181b`, matches the app chrome) for the ~95%
 *  case; but a mid-tone brand (e.g. #1877f2 -> 4.23:1, #8b5cf6 -> 4.23:1) can leave
 *  both poles sub-AA, since near-black caps the guaranteed floor at ~4.21:1. When
 *  that happens, escalate to pure black, since max(white, #000000) is >= 4.58:1 for
 *  ANY solid - restoring the AA guarantee without losing the #18181b aesthetic. */
export function readableForeground(solidHex: string): string {
  const white = contrastRatio(WHITE, solidHex);
  const nearBlack = contrastRatio(NEAR_BLACK, solidHex);
  const best = Math.max(white, nearBlack);
  if (best >= AA_TEXT) return white >= nearBlack ? WHITE : NEAR_BLACK;
  // Both preferred poles fall short - use the maximally-contrasting true pole.
  return contrastRatio(WHITE, solidHex) >= contrastRatio(PURE_BLACK, solidHex)
    ? WHITE
    : PURE_BLACK;
}

/**
 * Darken (light theme) / lighten (dark theme) a solid brand hex by an OKLCH
 * lightness delta, keeping hue + chroma so the state stays on-brand. `dl` is
 * signed: negative darkens, positive lightens.
 */
function shiftLightness(baseHex: string, dl: number): string {
  const { L, C, h } = rgbToOklch(hexToRgb(baseHex));
  return oklchToHex({ L: clamp01(L + dl), C, h });
}

/**
 * The readable accent (links, focus rings, hover borders): the brand hue+chroma
 * with lightness stepped down (light theme) / up (dark theme) until it clears
 * WCAG AA (>= 4.5:1) against the surface. Bounded L-step iteration - deterministic
 * and dependency-free. Chroma is reduced only by the gamut clamp, so the accent
 * stays hue-true instead of collapsing to the old muddy color-mix.
 */
function readableAccent(brandHex: string, surfaceHex: string, dir: 1 | -1): string {
  const { L, C, h } = rgbToOklch(hexToRgb(brandHex));
  // Walk lightness toward the readable side in small perceptual steps across the
  // whole [0, 1] axis, returning the FIRST in-gamut hue-true candidate that clears
  // AA. Every candidate (including the last) is checked - the loop never returns
  // an under-target value.
  for (let i = 0; i <= 50; i++) {
    const stepL = L + dir * 0.02 * i;
    if (stepL < 0 || stepL > 1) break;
    const candidate = oklchToHex({ L: stepL, C, h });
    if (contrastRatio(candidate, surfaceHex) >= AA_TEXT) return candidate;
  }
  // Hue-true lightness stepping could not reach AA within the L range (a pure
  // black/white brand on a same-toned surface, where there is no chroma to move):
  // fall back to the guaranteed max-contrast neutral so links/rings stay readable.
  return dir === 1 ? WHITE : NEAR_BLACK;
}

export type BrandRamp = {
  /** Filled control background - the brand color, verbatim. */
  accentSolid: string;
  /** Button hover background - OKLCH L -0.06 (light) / +0.06 (dark). */
  accentSolidHover: string;
  /** Button active background - OKLCH L -0.10 (light) / +0.10 (dark). */
  accentSolidActive: string;
  /** Text/icon on the solid fill - max-contrast white or near-black. */
  accentFg: string;
  /** Readable accent (links, rings, hover borders) - AA >= 4.5:1 vs surface. */
  accent: string;
};

export type BrandRampSet = { light: BrandRamp; dark: BrandRamp };

// Standalone components are commonly mounted on the SDK's light hover canvas,
// not only on a white card. Solving against this slightly darker surface also
// clears white, and keeps small accent labels AA-compliant in both placements.
const LIGHT_SURFACE = '#f4f4f5';
const DARK_SURFACE = '#18181b';

/**
 * Derive the full light + dark accent ramp from one brand hex. Non-hex input
 * (a legacy/partial public-config, or a bad `appearance` prop) falls back to the
 * default gold ramp rather than throwing during render.
 */
export function deriveBrandRamp(primaryHex: string | undefined | null): BrandRampSet {
  const solid = normalizeHex(primaryHex) ?? DEFAULT_BRAND_COLOR.toLowerCase();
  const fg = readableForeground(solid);
  return {
    light: {
      accentSolid: solid,
      accentSolidHover: shiftLightness(solid, -0.06),
      accentSolidActive: shiftLightness(solid, -0.1),
      accentFg: fg,
      accent: readableAccent(solid, LIGHT_SURFACE, -1),
    },
    dark: {
      accentSolid: solid,
      accentSolidHover: shiftLightness(solid, 0.06),
      accentSolidActive: shiftLightness(solid, 0.1),
      accentFg: fg,
      accent: readableAccent(solid, DARK_SURFACE, 1),
    },
  };
}

/**
 * Flatten a ramp set into the inline bridge custom-properties the provider emits
 * on `.authowl-root`. styles.css routes `-l` under light and `-d` under
 * dark/system-dark; `--ba-accent-solid` is `--ba-primary` verbatim (no bridge)
 * and `--ba-accent-fg` is theme-independent (one var). Keeping these as inline
 * `--ba-rt-*` bridges - rather than setting `--ba-accent*` directly - lets a host
 * stylesheet still override `--ba-accent`/`--ba-primary` on `.authowl-root`.
 */
export function brandRampVars(set: BrandRampSet): Record<string, string> {
  return {
    '--ba-rt-solid-hover-l': set.light.accentSolidHover,
    '--ba-rt-solid-hover-d': set.dark.accentSolidHover,
    '--ba-rt-solid-active-l': set.light.accentSolidActive,
    '--ba-rt-solid-active-d': set.dark.accentSolidActive,
    '--ba-rt-accent-l': set.light.accent,
    '--ba-rt-accent-d': set.dark.accent,
    // Foreground is chosen against the solid fill, which is theme-independent.
    '--ba-rt-accent-fg': set.light.accentFg,
  };
}
