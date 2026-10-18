import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, fromHex, inSrgbGamut, toCss, toHex } from './color';
import { measureContrast } from './contrast';
import { SHADCN_ALIASES, shadcnCss, themeCss, tokensCss } from './css';
import {
  BRANDS,
  brands,
  neutral,
  NEUTRAL_COLORS,
  palette,
  SCHEMES,
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
    'chart-muted': '#8E8E86', warning: '#A8530C', danger: '#C4313B', 'danger-solid': '#C4313B', 'on-danger': '#FFFFFF',
  },
  dark: {
    canvas: '#0A0A0B', surface: '#111113', raised: '#18181B', inset: '#0D0D0F',
    line: '#232327', 'line-strong': '#34343B', fg: '#EDEDEF', 'fg-muted': '#A1A1AA', 'fg-faint': '#7E7E87',
    'chart-muted': '#63636C', success: '#3DD68C', warning: '#F5A35B', danger: '#F2666F',
    'danger-solid': '#C4313B', 'on-danger': '#FFFFFF',
  },
};

/** Deliberate departures from the boards, each one an accessibility fix. */
const DEVIATIONS: Record<Scheme, Partial<Record<NeutralColor, { board: string; now: string }>>> = {
  light: { success: { board: '#14804A', now: '#007742' } },
  dark: {},
};

describe('fidelity to the approved boards', () => {
  it.each(SCHEMES)('every %s neutral renders as its approved hex or a documented deviation', (scheme) => {
    for (const token of NEUTRAL_COLORS) {
      if (token.endsWith('-soft')) continue;
      const expected = APPROVED[scheme][token] ?? DEVIATIONS[scheme][token]?.now;
      expect(expected, `${scheme} ${token} has no approved value`).toBeDefined();
      expect(toHex(neutral[scheme][token]), `${scheme} ${token}`).toBe(expected);
    }
  });

  it('keeps the AuthOwl accent exactly as approved', () => {
    expect(toHex(brands.authowl.dark.accent)).toBe('#F5B84C');
    expect(toHex(brands.authowl.light.accent)).toBe('#F5B84C');
    expect(toHex(brands.authowl.light['accent-fg'])).toBe('#9A5B05');
    expect(toHex(brands.authowl.light['on-accent'])).toBe('#1B1305');
  });

  it('keeps each product\'s own primary where it passes AA', () => {
    // billow/packages/ui/src/theme.css and hitsend/apps/web/src/app/globals.css.
    expect(toCss(brands.billow.light.accent)).toBe('oklch(0.51 0.23 277)');
    expect(toHex(brands.hitsend.light.accent)).toBe('#7C3AED');
    expect(toHex(brands.hitsend.dark.accent)).toBe('#8B5CF6');
    expect(toHex(brands.hitsend.dark['on-accent'])).toBe('#0F0F17');
  });

  it('documents every deviation against what the board had', () => {
    for (const scheme of SCHEMES) {
      for (const [token, { board, now }] of Object.entries(DEVIATIONS[scheme])) {
        expect(toHex(fromHex(board)), 'board value round-trips').toBe(board);
        expect(toHex(neutral[scheme][token as NeutralColor])).toBe(now);
      }
    }
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

  it('measures what shadcn primitives render through the aliases, and pins the known gaps', () => {
    type Alias = keyof typeof SHADCN_ALIASES;
    const surfaces: Alias[] = ['background', 'card', 'popover'];
    const pairs: [fg: Alias, bg: Alias][] = [
      ['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'],
      ['primary-foreground', 'primary'], ['secondary-foreground', 'secondary'], ['accent-foreground', 'accent'],
      ['sidebar-foreground', 'sidebar'], ['sidebar-primary-foreground', 'sidebar-primary'],
      ['sidebar-accent-foreground', 'sidebar-accent'], ['muted-foreground', 'muted'],
      ...surfaces.flatMap((bg): [Alias, Alias][] => [['muted-foreground', bg], ['destructive', bg], ['primary', bg]]),
    ];
    const failures = BRANDS.flatMap((brand) => SCHEMES.flatMap((scheme) => {
      const colors = palette(brand, scheme);
      return pairs
        .filter(([fg, bg]) => contrastRatio(colors[SHADCN_ALIASES[fg]], colors[SHADCN_ALIASES[bg]]) < 4.5)
        .map(([fg, bg]) => `${brand}/${scheme} ${fg} on ${bg}`);
    }));
    // Two shadcn text uses the alias layer cannot serve yet, pending a ruling:
    // `text-destructive` reads the destructive button's fill, and
    // `text-primary` reads the accent fill rather than its text form.
    const known = [
      ...BRANDS.flatMap((brand) => surfaces.map((bg) => `${brand}/dark destructive on ${bg}`)),
      ...surfaces.map((bg) => `authowl/light primary on ${bg}`),
      ...surfaces.map((bg) => `billow/dark primary on ${bg}`),
      ...surfaces.slice(1).map((bg) => `hitsend/dark primary on ${bg}`),
    ];
    expect(failures.sort()).toEqual(known.sort());
  });
});

describe('CSS outputs', () => {
  const tokens = tokensCss();

  it('gives every other brand a light and a dark accent block', () => {
    for (const brand of BRANDS.filter((b) => b !== 'authowl')) {
      expect(tokens).toContain(`[data-brand="${brand}"] {`);
      expect(tokens).toContain(`.dark[data-brand="${brand}"],\n.dark [data-brand="${brand}"] {`);
    }
  });

  it('resolves the font stacks on body too, where next/font often puts its class', () => {
    expect(tokens).toContain(':root,\nbody {\n  --ao-font-sans: var(--font-geist-sans, Geist)');
  });

  it('turns motion off for people who ask for reduced motion', () => {
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s+:root \{\s+--ao-duration-fast: 0ms;/);
  });

  it('only references variables tokens.css declares, in theme.css and shadcn.css', () => {
    const declared = new Set([...tokens.matchAll(/(--ao-[\w-]+):/g)].map((match) => match[1]));
    for (const layer of [themeCss(), shadcnCss()]) {
      const referenced = [...layer.matchAll(/var\((--ao-[\w-]+)\)/g)].map((match) => match[1]);
      expect(referenced.length).toBeGreaterThan(30);
      expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
    }
  });
});
