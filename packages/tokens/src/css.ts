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
 * shadcn/ui's variable names and the token each one reads, so its new-york
 * primitives render in the suite look unchanged.
 */
export const SHADCN_ALIASES = {
  background: 'canvas',
  foreground: 'fg',
  card: 'surface',
  'card-foreground': 'fg',
  popover: 'raised',
  'popover-foreground': 'fg',
  primary: 'accent',
  'primary-foreground': 'on-accent',
  secondary: 'raised',
  'secondary-foreground': 'fg',
  muted: 'inset',
  'muted-foreground': 'fg-muted',
  accent: 'raised',
  'accent-foreground': 'fg',
  destructive: 'danger-solid',
  border: 'line',
  input: 'line-strong',
  ring: 'ring',
  'chart-1': 'chart-1',
  'chart-2': 'chart-muted',
  'chart-3': 'success',
  'chart-4': 'warning',
  'chart-5': 'danger',
  sidebar: 'surface',
  'sidebar-foreground': 'fg',
  'sidebar-primary': 'accent',
  'sidebar-primary-foreground': 'on-accent',
  'sidebar-accent': 'raised',
  'sidebar-accent-foreground': 'fg',
  'sidebar-border': 'line',
  'sidebar-ring': 'ring',
} as const satisfies Record<string, ColorToken>;

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
      decl(`text-${name}-line-height`, `${step.lineHeight / 16}rem`),
      ...('tracking' in step ? [decl(`text-${name}-tracking`, `${step.tracking}em`)] : []),
    ]),
    ...Object.entries(radius).map(([name, px]) => decl(`radius-${name}`, `${px}px`)),
    decl('space-unit', `${space.unit / 16}rem`),
    ...Object.entries(motion.duration).map(([name, ms]) => decl(`duration-${name}`, `${ms}ms`)),
    ...Object.entries(motion.easing).map(([name, curve]) => decl(`ease-${name}`, curve)),
  ];
}

/**
 * `tokens.css`: the variables. Light on `:root`, dark under `.dark` (the
 * next-themes and shadcn convention every product already uses), and a brand
 * other than AuthOwl under `[data-brand]`, set on `<html>` with the scheme.
 */
export function tokensCss(): string {
  return file(HEADER, [
    block(':root', ['color-scheme: light;', ...colorDecls(palette(DEFAULT_BRAND, 'light')), ...shadowDecls('light'), ...staticDecls()]),
    // A variable resolves where it is declared, so the font stacks are declared
    // again on `body`: next/font's variable class lands on <html> or <body>.
    block(':root,\nbody', Object.entries(font).map(([name, stack]) => decl(`font-${name}`, stack))),
    block('.dark', ['color-scheme: dark;', ...colorDecls(palette(DEFAULT_BRAND, 'dark')), ...shadowDecls('dark')]),
    ...BRANDS.filter((brand) => brand !== DEFAULT_BRAND).flatMap((brand) => [
      block(`[data-brand="${brand}"]`, colorDecls(brands[brand].light)),
      block(`.dark[data-brand="${brand}"],\n.dark [data-brand="${brand}"]`, colorDecls(brands[brand].dark)),
    ]),
    // People who ask for less motion get none: every duration collapses to 0.
    block('@media (prefers-reduced-motion: reduce)', [
      block(':root', Object.keys(motion.duration).map((name) => decl(`duration-${name}`, '0ms'))),
    ]),
  ]);
}

/**
 * `theme.css`: the Tailwind 4 `@theme` entry. Utilities read the variables,
 * so `bg-surface`, `text-fg-muted`, `rounded-card` and `shadow-popover` follow
 * the scheme and brand without a rebuild. Import `tokens.css` first.
 */
export function themeCss(): string {
  return file(LAYER_HEADER, [
    block('@theme inline', [
      ...COLOR_TOKENS.map((token) => `--color-${token}: ${ref(token)};`),
      ...Object.keys(font).map((name) => `--font-${name}: ${ref(`font-${name}`)};`),
      ...Object.entries(type).flatMap(([name, step]) => [
        `--text-${name}: ${ref(`text-${name}`)};`,
        `--text-${name}--line-height: ${ref(`text-${name}-line-height`)};`,
        ...('tracking' in step ? [`--text-${name}--letter-spacing: ${ref(`text-${name}-tracking`)};`] : []),
      ]),
      ...Object.keys(radius).map((name) => `--radius-${name}: ${ref(`radius-${name}`)};`),
      `--spacing: ${ref('space-unit')};`,
      ...Object.keys(elevation.light).map((name) => `--shadow-${name}: ${ref(`shadow-${name}`)};`),
      ...Object.keys(motion.easing).map((name) => `--ease-${name}: ${ref(`ease-${name}`)};`),
    ]),
  ]);
}

/**
 * `shadcn.css`: shadcn/ui's variables pointed at the tokens. For Tailwind 4
 * shadcn setups (oklch values, not the Tailwind 3 `hsl(var(--x))` form).
 */
export function shadcnCss(): string {
  return file(LAYER_HEADER, [
    block(':root', [
      ...Object.entries(SHADCN_ALIASES).map(([name, token]) => `--${name}: ${cssVar(token)};`),
      `--radius: ${cssVar('radius-control')};`,
    ]),
  ]);
}
