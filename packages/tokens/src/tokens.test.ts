import { describe, expect, it } from 'vitest';
import { composite, fromHex, inSrgbGamut, toHex } from './color';
import { measureContrast } from './contrast';
import { PREFIX, shadcnCss, themeCss, tokensCss } from './css';
import {
  ACCENT_COLORS,
  BRANDS,
  brands,
  neutral,
  NEUTRAL_COLORS,
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
    const outside = BRANDS.flatMap((brand) => SCHEMES.flatMap((scheme) => [
      ...NEUTRAL_COLORS.filter((token) => !inSrgbGamut(neutral[scheme][token])).map((t) => `${scheme} ${t}`),
      ...ACCENT_COLORS.filter((token) => !inSrgbGamut(brands[brand][scheme][token])).map((t) => `${brand} ${scheme} ${t}`),
    ]));
    expect(outside).toEqual([]);
  });
});

describe('CSS outputs', () => {
  const tokens = tokensCss();

  it('declares every colour for both schemes', () => {
    const [light, dark] = [tokens.split('.dark {')[0]!, tokens.split('.dark {')[1]!.split('[data-brand')[0]!];
    for (const token of [...NEUTRAL_COLORS, ...ACCENT_COLORS]) {
      expect(light, `light ${token}`).toContain(`${PREFIX}${token}: oklch(`);
      expect(dark, `dark ${token}`).toContain(`${PREFIX}${token}: oklch(`);
    }
  });

  it('gives every other brand a light and a dark accent block', () => {
    for (const brand of BRANDS.filter((b) => b !== 'authowl')) {
      expect(tokens).toContain(`[data-brand="${brand}"] {`);
      expect(tokens).toContain(`.dark[data-brand="${brand}"],\n.dark [data-brand="${brand}"] {`);
    }
  });

  it('turns motion off for people who ask for reduced motion', () => {
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s+:root \{\s+--ao-duration-fast: 0ms;/);
  });

  it('maps every colour into the Tailwind 4 theme', () => {
    const theme = themeCss();
    expect(theme).toContain('@theme inline {');
    for (const token of [...NEUTRAL_COLORS, ...ACCENT_COLORS]) {
      expect(theme).toContain(`--color-${token}: var(${PREFIX}${token});`);
    }
  });

  it('points every shadcn alias at a token that exists', () => {
    const declared = new Set([...tokens.matchAll(/(--ao-[\w-]+):/g)].map((match) => match[1]));
    const referenced = [...shadcnCss().matchAll(/var\((--ao-[\w-]+)\)/g)].map((match) => match[1]);
    expect(referenced.length).toBeGreaterThan(20);
    expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
  });
});
