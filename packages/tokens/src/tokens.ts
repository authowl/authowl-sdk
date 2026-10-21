import { oklch, toCss, type Oklch } from './color';

/**
 * The AuthOwl suite design tokens. Every colour below is the OKLCH form of a
 * value on the founder-approved reference boards (plan 47, AO-8), so the CSS
 * renders exactly the signed-off design; `tokens.test.ts` pins each one to its
 * approved hex.
 */

export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];

/**
 * Colours every product shares, named by role. These are the `--ao-*`
 * variables; Tailwind and shadcn read them under shadcn's names (see css.ts).
 */
export const NEUTRAL_COLORS = [
  'canvas', 'surface', 'raised', 'inset', 'highlight', 'line', 'line-strong',
  'fg', 'fg-muted', 'fg-faint', 'chart-muted',
  'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft',
] as const;
export type NeutralColor = (typeof NEUTRAL_COLORS)[number];

/**
 * Colours each brand sets. `brand` fills primary buttons, `brand-hover` is
 * that fill under the pointer and `on-brand` is their label. `brand-text` is
 * the brand used as text or lines on a surface, which needs more contrast
 * than a fill, so it can differ.
 */
export const BRAND_COLORS = ['brand', 'brand-hover', 'on-brand', 'brand-text', 'brand-soft', 'ring', 'chart-1'] as const;
export type BrandColor = (typeof BRAND_COLORS)[number];

export const COLOR_TOKENS = [...NEUTRAL_COLORS, ...BRAND_COLORS] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** A translucent tint of `base`, for pill and selection backgrounds. */
export const tint = (base: Oklch, alpha: number): Oklch => ({ ...base, alpha });

const WHITE = oklch(1, 0, 0);
// The board's #14804A read 4.25:1 on its own tint (the Active pill), under AA,
// so light success is one step deeper: #007742.
const LIGHT_SUCCESS = oklch(0.4999, 0.124, 154.84);
const LIGHT_WARNING = oklch(0.5374, 0.1333, 52.12);
const LIGHT_DANGER = oklch(0.5447, 0.183, 22.38);
const DARK_SUCCESS = oklch(0.7794, 0.1655, 157.29);
const DARK_WARNING = oklch(0.7827, 0.1312, 60.3);
const DARK_DANGER = oklch(0.687, 0.1724, 18.98);

export const neutral: Record<Scheme, Record<NeutralColor, Oklch>> = {
  light: {
    canvas: oklch(0.9756, 0.0026, 106.45),
    surface: WHITE,
    raised: oklch(0.9845, 0.0026, 106.45),
    inset: oklch(0.9603, 0.004, 106.47),
    // A hovered or selected item. Not `raised`: a hovered item inside a
    // popover would match the popover itself.
    highlight: oklch(0.9603, 0.004, 106.47),
    line: oklch(0.9235, 0.0067, 106.53),
    'line-strong': oklch(0.871, 0.0095, 106.6),
    fg: oklch(0.2059, 0.0059, 285.87),
    'fg-muted': oklch(0.4744, 0.0144, 285.84),
    'fg-faint': oklch(0.5409, 0.0123, 285.98),
    'chart-muted': oklch(0.6443, 0.0117, 106.72),
    success: LIGHT_SUCCESS,
    'success-soft': tint(LIGHT_SUCCESS, 0.12),
    warning: LIGHT_WARNING,
    'warning-soft': tint(LIGHT_WARNING, 0.1),
    danger: LIGHT_DANGER,
    'danger-soft': tint(LIGHT_DANGER, 0.1),
  },
  dark: {
    canvas: oklch(0.1452, 0.0021, 286.13),
    surface: oklch(0.1785, 0.0041, 285.98),
    raised: oklch(0.2103, 0.0059, 285.89),
    inset: oklch(0.16, 0.0042, 285.92),
    highlight: oklch(0.23, 0.006, 285.9),
    line: oklch(0.2578, 0.0074, 285.87),
    'line-strong': oklch(0.3278, 0.0123, 285.7),
    fg: oklch(0.9467, 0.0027, 286.35),
    'fg-muted': oklch(0.7118, 0.0129, 286.07),
    // One step lighter than the board's #7E7E87, which is 4.41:1 on `raised`
    // (every popover) and under AA on `highlight`.
    'fg-faint': oklch(0.62, 0.0135, 285.98),
    'chart-muted': oklch(0.5028, 0.0141, 285.88),
    success: DARK_SUCCESS,
    'success-soft': tint(DARK_SUCCESS, 0.14),
    warning: DARK_WARNING,
    'warning-soft': tint(DARK_WARNING, 0.13),
    danger: DARK_DANGER,
    'danger-soft': tint(DARK_DANGER, 0.12),
  },
};

export const BRANDS = ['authowl', 'billow', 'hitsend'] as const;
export type Brand = (typeof BRANDS)[number];
export const DEFAULT_BRAND: Brand = 'authowl';

/**
 * One scheme of a brand. The ring and the highlighted chart series always use
 * the brand's text colour, which is the form that holds contrast on a surface.
 */
function accents(fill: Oklch, hover: Oklch, label: Oklch, text: Oklch, soft: Oklch): Record<BrandColor, Oklch> {
  return { brand: fill, 'brand-hover': hover, 'on-brand': label, 'brand-text': text, 'brand-soft': soft, ring: text, 'chart-1': text };
}

const GOLD = oklch(0.8197, 0.1406, 78.6);
// Gold leaves sRGB when lightened, so its hover darkens instead.
const GOLD_HOVER = oklch(0.78, 0.1406, 78.6);
const GOLD_INK = oklch(0.1928, 0.029, 81.35);
const GOLD_TEXT_LIGHT = oklch(0.5312, 0.1179, 64.53);
const BILLOW_LIGHT = oklch(0.51, 0.23, 277);
const BILLOW_DARK_FILL = oklch(0.58, 0.21, 277);
const BILLOW_DARK_TEXT = oklch(0.631, 0.1985, 276.87);
const VIOLET_LIGHT = oklch(0.5413, 0.2466, 293.01);
const VIOLET_DARK_FILL = oklch(0.6056, 0.2189, 292.72);
const VIOLET_DARK_TEXT = oklch(0.64, 0.2125, 292.72);
const VIOLET_INK = oklch(0.1725, 0.0165, 284.53);

/**
 * Brand colours. Adding a product is one entry here. Each hover moves the
 * fill 0.04 in L in the direction that raises its label's contrast.
 * - authowl: gold. Light mode keeps the gold fill (dark label) but draws
 *   text, lines and focus in a darker gold, since gold on white is 1.8:1.
 * - billow: its own indigo primary, `oklch(0.51 0.23 277)` light. Its dark
 *   primary (L 0.64) fails AA under white labels (about 3.6:1) and is outside
 *   sRGB, so the dark fill is L 0.58 and dark text is #6F76FE, the in-gamut
 *   colour screens show for it. See the README.
 * - hitsend: its own violet, #7C3AED light and #8B5CF6 dark. The dark violet
 *   is 4.45:1 as text on `surface`, under AA, so dark text is one step lighter
 *   (#9469FF), and that is also its hover.
 */
export const brands: Record<Brand, Record<Scheme, Record<BrandColor, Oklch>>> = {
  authowl: {
    light: accents(GOLD, GOLD_HOVER, GOLD_INK, GOLD_TEXT_LIGHT, tint(GOLD, 0.18)),
    dark: accents(GOLD, GOLD_HOVER, GOLD_INK, GOLD, tint(GOLD, 0.13)),
  },
  billow: {
    light: accents(BILLOW_LIGHT, oklch(0.47, 0.23, 277), WHITE, BILLOW_LIGHT, tint(BILLOW_LIGHT, 0.12)),
    dark: accents(BILLOW_DARK_FILL, oklch(0.54, 0.21, 277), WHITE, BILLOW_DARK_TEXT, tint(BILLOW_DARK_TEXT, 0.1)),
  },
  hitsend: {
    light: accents(VIOLET_LIGHT, oklch(0.5013, 0.2466, 293.01), WHITE, VIOLET_LIGHT, tint(VIOLET_LIGHT, 0.1)),
    dark: accents(VIOLET_DARK_FILL, VIOLET_DARK_TEXT, VIOLET_INK, VIOLET_DARK_TEXT, tint(VIOLET_DARK_TEXT, 0.1)),
  },
};

/**
 * Geist, read through the variables `next/font` and the `geist` package set
 * (`--font-geist-sans`, `--font-geist-mono`), because next/font registers the
 * face under a generated family name. The plain family name is the fallback.
 */
export const font = {
  sans: 'var(--font-geist-sans, Geist), ui-sans-serif, system-ui, sans-serif',
  mono: 'var(--font-geist-mono, "Geist Mono"), ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/**
 * The type scale, under Tailwind's names so stock shadcn classes (`text-sm`,
 * `text-lg`) are tokens. Three in-between steps the boards use are numbered.
 * Sizes and line heights in px; tracking in em.
 */
export const type = {
  '11': { size: 11, lineHeight: 16 },
  xs: { size: 12, lineHeight: 16 },
  '13': { size: 13, lineHeight: 20 },
  sm: { size: 14, lineHeight: 20 },
  '15': { size: 15, lineHeight: 22 },
  base: { size: 16, lineHeight: 24 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 28, tracking: -0.01 },
  '2xl': { size: 24, lineHeight: 32, tracking: -0.02 },
  '3xl': { size: 30, lineHeight: 36, tracking: -0.025 },
} as const satisfies Record<string, { size: number; lineHeight: number; tracking?: number }>;

/**
 * Corner radii in px, under Tailwind's names so shadcn's own classes land on
 * the boards: `sm` chips and menu items, `md` controls, `lg` tiles and
 * dialogs, `xl` cards. `rounded-full` stays Tailwind's.
 */
export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  '4xl': 32,
} as const;

/** Spacing is a 4px grid, plus 2 and 6 for tight icon gaps. The steps document what the boards use. */
export const space = {
  unit: 4,
  steps: [2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64],
} as const;

const ink = (alpha: number) => toCss(tint(neutral.light.fg, alpha));
const black = (alpha: number) => toCss(oklch(0, 0, 0, alpha));
const edge = toCss(neutral.dark.line);

/**
 * Cards, selected tabs and floating layers cast shadows. Light shadows are
 * tinted with the text colour; dark ones add a hairline, since a shadow alone
 * barely shows on a near-black canvas.
 */
export const elevation: Record<Scheme, { popover: string; dialog: string; card: string; tab: string }> = {
  light: {
    card: `0 4px 16px ${ink(0.06)}, 0 1px 2px ${ink(0.05)}`,
    tab: `0 1px 2px ${ink(0.1)}, 0 0 0 1px ${toCss(neutral.light.line)}`,
    popover: `0 4px 16px ${ink(0.08)}, 0 1px 2px ${ink(0.06)}`,
    dialog: `0 16px 48px ${ink(0.16)}, 0 2px 6px ${ink(0.08)}`,
  },
  dark: {
    card: `0 16px 48px ${black(0.6)}, 0 0 0 1px ${edge}`,
    tab: `0 0 0 1px ${toCss(neutral.dark['line-strong'])}`,
    popover: `0 4px 16px ${black(0.4)}, 0 0 0 1px ${edge}`,
    dialog: `0 16px 48px ${black(0.6)}, 0 0 0 1px ${edge}`,
  },
};

/** Motion: hover and switches are fast, tiles and popovers base, dialogs and sheets slow. */
export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} as const;

/** The resolved colour of every token for one brand and scheme. */
export function palette(brand: Brand, scheme: Scheme): Record<ColorToken, Oklch> {
  return { ...neutral[scheme], ...brands[brand][scheme] };
}
