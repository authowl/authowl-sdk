import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, inSrgbGamut, oklch, toCss, toHex } from './color';
import { measureContrast } from './contrast';
import { shadcnCss, THEME_COLORS, themeCss, tokensCss } from './css';
import {
  BRANDS,
  brands,
  neutral,
  NEUTRAL_COLORS,
  palette,
  radius,
  SCHEMES,
  tint,
  type,
  type NeutralColor,
  type Scheme,
} from './tokens';

/**
 * The founder-approved board values (plan 47, AO-8, canvas v12). The tokens
 * are stored as OKLCH; this is the contract they must still render as.
 */
const APPROVED: Record<Scheme, Partial<Record<NeutralColor, string>>> = {
  light: {
    canvas: '#F7F7F5', surface: '#FFFFFF', raised: '#FAFAF8', inset: '#F2F2EF',
    line: '#E6E6E1', 'line-strong': '#D5D5CE', fg: '#17171A', 'fg-muted': '#5B5B64', 'fg-faint': '#6E6E76',
    'chart-muted': '#8E8E86', warning: '#A8530C', danger: '#C4313B',
  },
  dark: {
    canvas: '#0A0A0B', surface: '#111113', raised: '#18181B', inset: '#0D0D0F',
    line: '#232327', 'line-strong': '#34343B', fg: '#EDEDEF', 'fg-muted': '#A1A1AA',
    'chart-muted': '#63636C', success: '#3DD68C', warning: '#F5A35B', danger: '#F2666F',
  },
};

/**
 * Deliberate departures from the boards, each one an accessibility fix, and
 * the one token the boards had no value for (`board: null`).
 */
const DEVIATIONS: Record<Scheme, Partial<Record<NeutralColor, { board: string | null; now: string }>>> = {
  light: {
    // #14804A is 4.25:1 on its own tint (the Active pill).
    success: { board: '#14804A', now: '#007742' },
    // The hovered or selected item; the boards drew it with `raised`, which
    // is also every popover.
    highlight: { board: null, now: '#F2F2EF' },
  },
  dark: {
    // #7E7E87 is 4.41:1 on `raised` and under AA on `highlight`.
    'fg-faint': { board: '#7E7E87', now: '#85858E' },
    highlight: { board: null, now: '#1D1D20' },
  },
};

/**
 * The boards' type steps in px (size, line height). The boards also set 12.5
 * (served by `xs` and `13`), 17 (by `base`) and 26 (by `2xl`): half-pixel and
 * one-off sizes are mock artefacts.
 */
const BOARD_TYPE = {
  '11': [11, 16], xs: [12, 16], '13': [13, 20], sm: [14, 20], '15': [15, 22],
  base: [16, 24], lg: [18, 28], xl: [20, 28], '2xl': [24, 32], '3xl': [30, 36],
};

/**
 * The boards' radii in px. Their in-between values land on the nearest step:
 * 2 to 3 on `xs`, 5 to 8 on `sm`, 9 to 11 on `md`, 14 on `lg`, 18 on `xl`.
 */
const BOARD_RADIUS = { xs: 4, sm: 6, md: 10, lg: 12, xl: 16 };

describe('fidelity to the approved boards', () => {
  it.each(SCHEMES)('every %s neutral renders as its approved hex or a documented deviation', (scheme) => {
    for (const token of NEUTRAL_COLORS) {
      if (token.endsWith('-soft')) continue;
      const approved = APPROVED[scheme][token];
      const deviation = DEVIATIONS[scheme][token];
      expect(approved === undefined || deviation === undefined, `${scheme} ${token} is approved and a deviation`).toBe(true);
      const expected = approved ?? deviation?.now;
      expect(expected, `${scheme} ${token} has no approved value`).toBeDefined();
      expect(toHex(neutral[scheme][token]), `${scheme} ${token}`).toBe(expected);
      if (deviation?.board) expect(deviation.now).not.toBe(deviation.board);
    }
  });

  it('keeps the AuthOwl brand exactly as approved', () => {
    expect(toHex(brands.authowl.dark.brand)).toBe('#F5B84C');
    expect(toHex(brands.authowl.light.brand)).toBe('#F5B84C');
    expect(toHex(brands.authowl.light['brand-text'])).toBe('#9A5B05');
    expect(toHex(brands.authowl.light['on-brand'])).toBe('#1B1305');
  });

  it("keeps each product's own primary where it passes AA", () => {
    // billow/packages/ui/src/theme.css and hitsend/apps/web/src/app/globals.css.
    expect(toCss(brands.billow.light.brand)).toBe('oklch(0.51 0.23 277)');
    expect(toHex(brands.hitsend.light.brand)).toBe('#7C3AED');
    expect(toHex(brands.hitsend.dark.brand)).toBe('#8B5CF6');
    expect(toHex(brands.hitsend.dark['on-brand'])).toBe('#0F0F17');
  });

  it('pins every hover fill', () => {
    const hovers = BRANDS.flatMap((brand) => SCHEMES.map((scheme) => `${brand}/${scheme} ${toHex(brands[brand][scheme]['brand-hover'])}`));
    expect(hovers).toEqual([
      'authowl/light #E8AB3D', 'authowl/dark #E8AB3D',
      'billow/light #4637D7', 'billow/dark #5756E4',
      'hitsend/light #7129DF', 'hitsend/dark #9469FF',
    ]);
  });

  it('keeps the type scale on the boards', () => {
    expect(Object.fromEntries(Object.entries(type).map(([name, step]) => [name, [step.size, step.lineHeight]]))).toEqual(BOARD_TYPE);
  });

  it('keeps the radius scale on the boards', () => {
    expect(radius).toMatchObject(BOARD_RADIUS);
  });
});

describe('accessibility', () => {
  it('passes WCAG AA on every approved pairing, for every brand and scheme', () => {
    const failures = measureContrast()
      .filter((result) => !result.passes)
      .map((r) => `${r.brand}/${r.scheme}: ${r.fg} on ${r.bg}${r.over ? ` over ${r.over}` : ''} is ${r.ratio.toFixed(2)}, needs ${r.min}`);
    expect(failures).toEqual([]);
  });

  it('measures the tinted pairs on the composited colour, not the bare tint', () => {
    const tinted = composite(neutral.light['success-soft'], neutral.light.surface);
    expect(toHex(tinted)).not.toBe(toHex(neutral.light.surface));
    expect(toHex(tinted)).not.toBe(toHex(neutral.light.success));
  });

  it('keeps every colour inside sRGB, so no screen clamps it', () => {
    const outside = BRANDS.flatMap((brand) => SCHEMES.flatMap((scheme) => Object.entries(palette(brand, scheme))
      .filter(([, color]) => !inSrgbGamut(color))
      .map(([token]) => `${brand} ${scheme} ${token}`)));
    expect(outside).toEqual([]);
  });

  it("passes AA on shadcn's destructive button recipe", () => {
    // `bg-destructive text-white`, and `dark:bg-destructive/60` in dark.
    const white = oklch(1, 0, 0);
    expect(contrastRatio(white, neutral.light.danger)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(white, composite(tint(neutral.dark.danger, 0.6), neutral.dark.surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('measures what shadcn primitives render through the theme names, and pins the known gaps', () => {
    type Name = keyof typeof THEME_COLORS;
    const surfaces: Name[] = ['background', 'card', 'popover'];
    const textPairs: [fg: Name, bg: Name][] = [
      ['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'],
      ['primary-foreground', 'primary'], ['primary-foreground', 'primary-hover'], ['secondary-foreground', 'secondary'],
      ['accent-foreground', 'accent'], ['muted-foreground', 'accent'], ['destructive', 'accent'],
      ['sidebar-foreground', 'sidebar'], ['sidebar-primary-foreground', 'sidebar-primary'],
      ['sidebar-accent-foreground', 'sidebar-accent'], ['muted-foreground', 'muted'],
      ...surfaces.flatMap((bg): [Name, Name][] => [
        ['muted-foreground', bg], ['destructive', bg], ['primary-text', bg], ['primary', bg],
      ]),
    ];
    const chartPairs: [Name, Name][] = (['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const).map((chart) => [chart, 'card']);
    const failures = BRANDS.flatMap((brand) => SCHEMES.flatMap((scheme) => {
      const colors = palette(brand, scheme);
      const ratio = ([fg, bg]: [Name, Name]) => contrastRatio(colors[THEME_COLORS[fg]], colors[THEME_COLORS[bg]]);
      return [
        ...textPairs.filter((pair) => ratio(pair) < 4.5),
        ...chartPairs.filter((pair) => ratio(pair) < 3),
      ].map(([fg, bg]) => `${brand}/${scheme} ${fg} on ${bg}`);
    }));
    // `text-primary` is the fill. Gold cannot be text on white and the dark
    // fills sit near the limit; `text-primary-text` is the text form.
    const known = [
      ...surfaces.map((bg) => `authowl/light primary on ${bg}`),
      ...surfaces.map((bg) => `billow/dark primary on ${bg}`),
      ...surfaces.slice(1).map((bg) => `hitsend/dark primary on ${bg}`),
    ];
    expect(failures.sort()).toEqual(known.sort());
  });
});

describe('CSS outputs', () => {
  const tokens = tokensCss();
  const theme = themeCss();

  it('gives every brand both schemes, picked by scheme wherever either changes', () => {
    for (const brand of BRANDS) {
      const body = tokens.split(`[data-brand="${brand}"] {`)[1]?.split('}')[0] ?? '';
      expect(body).toContain(`--ao-light-brand: ${toCss(brands[brand].light.brand)};`);
      expect(body).toContain(`--ao-dark-brand: ${toCss(brands[brand].dark.brand)};`);
    }
    expect(tokens).toContain(':root,\n[data-brand] {\n  --ao-brand: var(--ao-light-brand);');
    expect(tokens).toContain('.dark,\n.dark [data-brand] {\n  --ao-brand: var(--ao-dark-brand);');
  });

  it('resolves the font stacks on body too, where next/font often puts its class', () => {
    expect(tokens).toContain(':root,\nbody {\n  --ao-font-sans: var(--font-geist-sans, Geist)');
  });

  it('turns motion off for people who ask for reduced motion', () => {
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s+:root \{\s+--ao-duration-fast: 0ms;/);
  });

  it("exposes exactly shadcn's colour names and the extras to Tailwind", () => {
    const utilities = [...theme.matchAll(/--color-([\w-]+):/g)].map((match) => match[1]);
    expect(utilities).toEqual(Object.keys(THEME_COLORS));
    expect(theme).toContain('@custom-variant dark (&:is(.dark *));');
    expect(theme).not.toContain('--spacing');
  });

  it('declares the shadcn variables on every scope that changes a token', () => {
    expect(shadcnCss()).toContain(':root,\n.dark,\n[data-brand] {\n  --background: var(--ao-canvas);');
  });

  it('only references variables tokens.css declares, in every output', () => {
    const declared = new Set([...tokens.matchAll(/(--ao-[\w-]+):/g)].map((match) => match[1]));
    for (const layer of [tokens, theme, shadcnCss()]) {
      const referenced = [...layer.matchAll(/var\((--ao-[\w-]+)\)/g)].map((match) => match[1]);
      expect(referenced.length).toBeGreaterThan(10);
      expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
    }
  });
});
