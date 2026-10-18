import { toCss } from './color';
import {
  ACCENT_COLORS,
  BRANDS,
  brands,
  DEFAULT_BRAND,
  elevation,
  font,
  motion,
  neutral,
  NEUTRAL_COLORS,
  radius,
  space,
  type,
  type Brand,
  type ColorToken,
  type Scheme,
} from './tokens';

/** Every token is a CSS variable under this prefix, so nothing collides with a product's own. */
export const PREFIX = '--ao-';

/** `var(--ao-<token>)`, for inline styles in TypeScript. */
export function cssVar(token: ColorToken | `radius-${keyof typeof radius}` | `shadow-${'popover' | 'dialog'}`): string {
  return `var(${PREFIX}${token})`;
}

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.map((line) => `  ${line}`).join('\n')}\n}\n`;
const decl = (name: string, value: string | number) => `${PREFIX}${name}: ${value};`;

function colorLines(scheme: Scheme, brand: Brand, include: 'all' | 'accents'): string[] {
  const neutralLines = NEUTRAL_COLORS.map((token) => decl(token, toCss(neutral[scheme][token])));
  const accentLines = ACCENT_COLORS.map((token) => decl(token, toCss(brands[brand][scheme][token])));
  return include === 'all' ? [...neutralLines, ...accentLines] : accentLines;
}

function staticLines(): string[] {
  return [
    decl('font-sans', font.sans),
    decl('font-mono', font.mono),
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

const shadowLines = (scheme: Scheme) =>
  Object.entries(elevation[scheme]).map(([name, shadow]) => decl(`shadow-${name}`, shadow));

/**
 * `tokens.css`: the variables. Light on `:root`, dark under `.dark` (the
 * next-themes and shadcn convention every product already uses), and a brand
 * other than AuthOwl under `[data-brand]` on `<html>` or any container.
 */
export function tokensCss(): string {
  const parts = [
    '/* @authowl/tokens: generated, do not edit. */\n',
    block(':root', ['color-scheme: light;', ...colorLines('light', DEFAULT_BRAND, 'all'), ...shadowLines('light'), ...staticLines()]),
    block('.dark', ['color-scheme: dark;', ...colorLines('dark', DEFAULT_BRAND, 'all'), ...shadowLines('dark')]),
    ...BRANDS.filter((brand) => brand !== DEFAULT_BRAND).flatMap((brand) => [
      block(`[data-brand="${brand}"]`, colorLines('light', brand, 'accents')),
      block(`.dark[data-brand="${brand}"],\n.dark [data-brand="${brand}"]`, colorLines('dark', brand, 'accents')),
    ]),
    // People who ask for less motion get none: every duration collapses to 0.
    `@media (prefers-reduced-motion: reduce) {\n  :root {\n${Object.keys(motion.duration)
      .map((name) => `    ${decl(`duration-${name}`, '0ms')}`)
      .join('\n')}\n  }\n}\n`,
  ];
  return parts.join('\n');
}

/**
 * `theme.css`: the Tailwind 4 `@theme` entry. Utilities read the variables,
 * so `bg-surface`, `text-fg-muted`, `rounded-card` and `shadow-popover` follow
 * the scheme and brand without a rebuild. Import `tokens.css` first.
 */
export function themeCss(): string {
  const tokens = [...NEUTRAL_COLORS, ...ACCENT_COLORS];
  const lines = [
    ...tokens.map((token) => `--color-${token}: var(${PREFIX}${token});`),
    `--font-sans: var(${PREFIX}font-sans);`,
    `--font-mono: var(${PREFIX}font-mono);`,
    ...Object.entries(type).flatMap(([name, step]) => [
      `--text-${name}: var(${PREFIX}text-${name});`,
      `--text-${name}--line-height: var(${PREFIX}text-${name}-line-height);`,
      ...('tracking' in step ? [`--text-${name}--letter-spacing: var(${PREFIX}text-${name}-tracking);`] : []),
    ]),
    ...Object.keys(radius).map((name) => `--radius-${name}: var(${PREFIX}radius-${name});`),
    `--spacing: var(${PREFIX}space-unit);`,
    ...Object.keys(elevation.light).map((name) => `--shadow-${name}: var(${PREFIX}shadow-${name});`),
    ...Object.keys(motion.easing).map((name) => `--ease-${name}: var(${PREFIX}ease-${name});`),
  ];
  return `/* @authowl/tokens: generated, do not edit. Import "@authowl/tokens/tokens.css" first. */\n\n${block('@theme inline', lines)}`;
}

/**
 * `shadcn.css`: shadcn/ui's variable names pointed at the tokens, so its
 * new-york primitives render in the suite look unchanged. For Tailwind 4
 * shadcn setups (oklch values, not the Tailwind 3 `hsl(var(--x))` form).
 */
export function shadcnCss(): string {
  const alias: Record<string, ColorToken | string> = {
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
  };
  const lines = [
    ...Object.entries(alias).map(([name, token]) => `--${name}: var(${PREFIX}${token});`),
    `--radius: var(${PREFIX}radius-control);`,
  ];
  return `/* @authowl/tokens: generated, do not edit. Import "@authowl/tokens/tokens.css" first. */\n\n${block(':root', lines)}`;
}
