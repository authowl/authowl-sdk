import { toCss, type Oklch } from './color';
import {
  BRANDS,
  brands,
  COLOR_TOKENS,
  DEFAULT_BRAND,
  elevation,
  font,
  motion,
  palette,
  radius,
  space,
  type,
  type ColorToken,
  type Scheme,
} from './tokens';

/** Every token is a CSS variable under this prefix, so nothing collides with a product's own. */
export const PREFIX = '--ao-';

type TypeStep = keyof typeof type;
type TrackedStep = { [K in TypeStep]: (typeof type)[K] extends { tracking: number } ? K : never }[TypeStep];

/** The name, without the prefix, of every variable `tokens.css` declares. */
export type CssVarName =
  | ColorToken
  | `font-${keyof typeof font}`
  | `text-${TypeStep}`
  | `text-${TypeStep}-line-height`
  | `text-${TrackedStep}-tracking`
  | `radius-${keyof typeof radius}`
  | 'space-unit'
  | `shadow-${keyof (typeof elevation)[Scheme]}`
  | `duration-${keyof typeof motion.duration}`
  | `ease-${keyof typeof motion.easing}`;

const ref = (name: string) => `var(${PREFIX}${name})`;

/** `var(--ao-<name>)`, for inline styles in TypeScript. */
export function cssVar(name: CssVarName): string {
  return ref(name);
}

/**
 * The colour vocabulary products write: shadcn/ui's names plus a few extras
 * that do not collide with them, each reading one token. theme.css turns
 * these into Tailwind utilities (`bg-card`, `text-muted-foreground`) and
 * shadcn.css into shadcn's raw variables (`--card`), so a pulled shadcn
 * component is themed by the tokens with no edits.
 */
export const THEME_COLORS = {
  background: 'canvas',
  foreground: 'fg',
  'foreground-faint': 'fg-faint',
  card: 'surface',
  'card-foreground': 'fg',
  popover: 'raised',
  'popover-foreground': 'fg',
  primary: 'brand',
  'primary-foreground': 'on-brand',
  'primary-hover': 'brand-hover',
  'primary-text': 'brand-text',
  'primary-soft': 'brand-soft',
  secondary: 'highlight',
  'secondary-foreground': 'fg',
  muted: 'inset',
  'muted-foreground': 'fg-muted',
  accent: 'highlight',
  'accent-foreground': 'fg',
  destructive: 'danger',
  'destructive-soft': 'danger-soft',
  success: 'success',
  'success-soft': 'success-soft',
  warning: 'warning',
  'warning-soft': 'warning-soft',
  border: 'line',
  input: 'line-strong',
  ring: 'ring',
  // A neutral ramp behind the one series a chart is about (`chart-1`).
  'chart-1': 'chart-1',
  'chart-2': 'chart-muted',
  'chart-3': 'fg-faint',
  'chart-4': 'fg-muted',
  'chart-5': 'fg',
  sidebar: 'surface',
  'sidebar-foreground': 'fg',
  'sidebar-primary': 'brand',
  'sidebar-primary-foreground': 'on-brand',
  'sidebar-accent': 'highlight',
  'sidebar-accent-foreground': 'fg',
  'sidebar-border': 'line',
  'sidebar-ring': 'ring',
} as const satisfies Record<string, ColorToken>;

/**
 * Tailwind's shadow scale. The boards are flat, so the small steps (cards,
 * outline buttons) cast nothing and only floating layers cast a shadow.
 */
const SHADOWS: Record<string, keyof (typeof elevation)[Scheme] | null> = {
  xs: null,
  sm: null,
  md: 'popover',
  lg: 'dialog',
  xl: 'dialog',
  '2xl': 'dialog',
};

const HEADER = '/* @authowl/tokens: generated, do not edit. */';
const LAYER_HEADER = '/* @authowl/tokens: generated, do not edit. Import "@authowl/tokens/tokens.css" first. */';

/** A rule; a body line may itself be a nested multi-line rule. */
const block = (selector: string, body: string[]) =>
  `${selector} {\n${body.join('\n').trimEnd().split('\n').map((line) => `  ${line}`).join('\n')}\n}\n`;
const file = (header: string, blocks: string[]) => [`${header}\n`, ...blocks].join('\n');
const decl = (name: string, value: string | number) => `${PREFIX}${name}: ${value};`;

const colorDecls = (colors: Partial<Record<ColorToken, Oklch>>) =>
  COLOR_TOKENS.flatMap((token) => (colors[token] ? [decl(token, toCss(colors[token]))] : []));

const shadowDecls = (scheme: Scheme) =>
  Object.entries(elevation[scheme]).map(([name, shadow]) => decl(`shadow-${name}`, shadow));

function staticDecls(): string[] {
  return [
    ...Object.entries(type).flatMap(([name, step]) => [
      decl(`text-${name}`, `${step.size / 16}rem`),
      // A unitless ratio, as Tailwind writes it, so a larger child that sets
      // no leading of its own does not inherit a too-small line box.
      decl(`text-${name}-line-height`, `calc(${step.lineHeight} / ${step.size})`),
      ...('tracking' in step ? [decl(`text-${name}-tracking`, `${step.tracking}em`)] : []),
    ]),
    ...Object.entries(radius).map(([name, px]) => decl(`radius-${name}`, `${px}px`)),
    decl('space-unit', `${space.unit / 16}rem`),
    ...Object.entries(motion.duration).map(([name, ms]) => decl(`duration-${name}`, `${ms}ms`)),
    ...Object.entries(motion.easing).map(([name, curve]) => decl(`ease-${name}`, curve)),
  ];
}

/** A brand's dark colours apply with `.dark` on the same element, above it, or below it. */
const darkBrandSelector = (brand: string) =>
  `.dark[data-brand="${brand}"],\n.dark [data-brand="${brand}"],\n[data-brand="${brand}"] .dark`;

/**
 * `tokens.css`: the variables. Light on `:root`, dark under `.dark` (the
 * next-themes and shadcn convention every product already uses), and each
 * brand under `[data-brand]`. The scheme and the brand can each sit on
 * `<html>` or on any container, in either nesting order.
 */
export function tokensCss(): string {
  return file(HEADER, [
    block(':root', ['color-scheme: light;', ...colorDecls(palette(DEFAULT_BRAND, 'light')), ...shadowDecls('light'), ...staticDecls()]),
    // A variable resolves where it is declared, so the font stacks are declared
    // again on `body`: next/font's variable class lands on <html> or <body>.
    block(':root,\nbody', Object.entries(font).map(([name, stack]) => decl(`font-${name}`, stack))),
    block('.dark', ['color-scheme: dark;', ...colorDecls(palette(DEFAULT_BRAND, 'dark')), ...shadowDecls('dark')]),
    ...BRANDS.flatMap((brand) => [
      block(`[data-brand="${brand}"]`, colorDecls(brands[brand].light)),
      block(darkBrandSelector(brand), colorDecls(brands[brand].dark)),
    ]),
    // People who ask for less motion get none: every duration collapses to 0.
    block('@media (prefers-reduced-motion: reduce)', [
      block(':root', Object.keys(motion.duration).map((name) => decl(`duration-${name}`, '0ms'))),
    ]),
  ]);
}

/**
 * `theme.css`: the one Tailwind 4 `@theme` a product needs. It replaces the
 * product's own `@theme inline` block: shadcn's colour names, Tailwind's type,
 * radius and shadow scales, and the default transition all read the tokens,
 * so utilities follow the scheme and brand without a rebuild. Import
 * `tokens.css` first.
 */
export function themeCss(): string {
  return file(LAYER_HEADER, [
    '@custom-variant dark (&:is(.dark *));\n',
    block('@theme inline', [
      ...Object.entries(THEME_COLORS).map(([name, token]) => `--color-${name}: ${ref(token)};`),
      ...Object.keys(font).map((name) => `--font-${name}: ${ref(`font-${name}`)};`),
      ...Object.entries(type).flatMap(([name, step]) => [
        `--text-${name}: ${ref(`text-${name}`)};`,
        `--text-${name}--line-height: ${ref(`text-${name}-line-height`)};`,
        ...('tracking' in step ? [`--text-${name}--letter-spacing: ${ref(`text-${name}-tracking`)};`] : []),
      ]),
      ...Object.keys(radius).map((name) => `--radius-${name}: ${ref(`radius-${name}`)};`),
      ...Object.entries(SHADOWS).map(([name, shadow]) => `--shadow-${name}: ${shadow ? ref(`shadow-${shadow}`) : '0 0 #0000'};`),
      ...Object.keys(motion.easing).map((name) => `--ease-${name}: ${ref(`ease-${name}`)};`),
      `--default-transition-duration: ${ref('duration-base')};`,
      `--default-transition-timing-function: ${ref('ease-standard')};`,
    ]),
  ]);
}

/**
 * `shadcn.css`: shadcn/ui's raw variables (`--background`, `--primary` and
 * the rest), for code that reads them with `var()` instead of a utility.
 * Declared on every scope that changes a token, so each one resolves to the
 * scheme and brand in force there.
 */
export function shadcnCss(): string {
  return file(LAYER_HEADER, [
    block(':root,\n.dark,\n[data-brand]', [
      ...Object.entries(THEME_COLORS).map(([name, token]) => `--${name}: ${cssVar(token)};`),
      `--radius: ${cssVar('radius-md')};`,
    ]),
  ]);
}
