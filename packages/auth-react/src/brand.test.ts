import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_COLOR,
  brandRampVars,
  contrastRatio,
  deriveBrandRamp,
  hexToOklch,
  hueDegrees,
  isHex6,
  normalizeHex,
  oklchToHex,
  readableForeground,
} from './brand';

// Representative brand colors incl. the audit case (#b7791f) and the two the
// founder wants proven (a blue, a green), plus the near-white/near-black edges.
const SAMPLES = {
  gold: '#F5B84C',
  auditAmber: '#b7791f',
  blue: '#1f6feb',
  green: '#16a34a',
  red: '#dc2626',
  nearWhite: '#fafafa',
  nearBlack: '#111111',
  // Pure black/white are the brand-boundary cases the Storybook a11y matrix
  // exercises - the accent solve must still clear AA against both surfaces.
  pureWhite: '#ffffff',
  pureBlack: '#000000',
} as const;

const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#18181b';
const AA = 4.5;

describe('hex guards', () => {
  it('accepts 6-digit hex only', () => {
    expect(isHex6('#F5B84C')).toBe(true);
    expect(isHex6('#fff')).toBe(false);
    expect(isHex6('rebeccapurple')).toBe(false);
    expect(isHex6(undefined)).toBe(false);
  });

  it('normalizeHex lowercases valid hex and rejects the rest', () => {
    expect(normalizeHex('#F5B84C')).toBe('#f5b84c');
    expect(normalizeHex('rgb(1,2,3)')).toBeNull();
  });
});

describe('OKLCH round-trip', () => {
  // hex -> OKLCH -> hex should return within a per-channel tolerance (the only
  // loss is 8-bit quantisation + the gamut clamp; in-gamut inputs stay tight).
  it('round-trips every sample within 2/255 per channel', () => {
    for (const hex of Object.values(SAMPLES)) {
      const back = oklchToHex(hexToOklch(hex));
      for (let i = 1; i < 7; i += 2) {
        const a = parseInt(hex.slice(i, i + 2), 16);
        const b = parseInt(back.slice(i, i + 2), 16);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('deriveBrandRamp', () => {
  it('keeps the solid fill equal to the brand color (lowercased)', () => {
    const r = deriveBrandRamp('#F5B84C');
    expect(r.light.accentSolid).toBe('#f5b84c');
    expect(r.dark.accentSolid).toBe('#f5b84c');
  });

  it('picks a foreground with >= 4.5:1 contrast on the fill for gold/blue/green', () => {
    for (const hex of [SAMPLES.gold, SAMPLES.blue, SAMPLES.green]) {
      const r = deriveBrandRamp(hex);
      expect(contrastRatio(r.light.accentFg, r.light.accentSolid)).toBeGreaterThanOrEqual(AA);
      // Foreground is theme-independent (fill is the same in both themes).
      expect(r.dark.accentFg).toBe(r.light.accentFg);
    }
  });

  it('white-on-gold is rejected in favour of near-black', () => {
    expect(readableForeground('#f5b84c')).toBe('#18181b');
    expect(deriveBrandRamp('#F5B84C').light.accentFg).toBe('#18181b');
  });

  it('guarantees >= 4.5:1 for mid-tone brands where both preferred poles fall short', () => {
    // These land sub-AA against BOTH white and near-black (#18181b caps the floor
    // at ~4.21:1); the solver must escalate to pure black to keep the AA guarantee.
    for (const hex of ['#1877f2', '#8b5cf6', '#6366f1', '#808080', '#000000', '#ffffff']) {
      const fg = readableForeground(hex);
      expect(contrastRatio(fg, hex)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('makes --ba-accent hit AA >= 4.5:1 against the surface in both themes', () => {
    for (const hex of Object.values(SAMPLES)) {
      const r = deriveBrandRamp(hex);
      expect(contrastRatio(r.light.accent, LIGHT_SURFACE)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(r.dark.accent, DARK_SURFACE)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('does NOT collapse chroma to mud like the old color-mix (gold accent stays amber)', () => {
    const r = deriveBrandRamp('#F5B84C');
    // The old derivation produced #624a1e; the new one keeps a saturated amber.
    expect(r.light.accent).not.toBe('#624a1e');
    const { C } = hexToOklch(r.light.accent);
    expect(C).toBeGreaterThan(0.08); // real chroma retained, not greyed out
  });

  it('hover/active preserve hue (drift <= 2 degrees) where chroma is non-trivial', () => {
    for (const hex of [SAMPLES.gold, SAMPLES.auditAmber, SAMPLES.blue, SAMPLES.green, SAMPLES.red]) {
      const r = deriveBrandRamp(hex);
      const baseHue = hueDegrees(hexToOklch(hex));
      for (const theme of [r.light, r.dark]) {
        for (const state of [theme.accentSolidHover, theme.accentSolidActive]) {
          const drift = Math.abs(hueDegrees(hexToOklch(state)) - baseHue);
          expect(Math.min(drift, 360 - drift)).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('hover is darker than solid (light) / lighter than solid (dark); active more so', () => {
    const r = deriveBrandRamp('#1f6feb');
    const l = (h: string) => hexToOklch(h).L;
    expect(l(r.light.accentSolidHover)).toBeLessThan(l(r.light.accentSolid));
    expect(l(r.light.accentSolidActive)).toBeLessThan(l(r.light.accentSolidHover));
    expect(l(r.dark.accentSolidHover)).toBeGreaterThan(l(r.dark.accentSolid));
    expect(l(r.dark.accentSolidActive)).toBeGreaterThan(l(r.dark.accentSolidHover));
  });

  it('falls back to the gold default ramp for non-hex / missing input', () => {
    expect(deriveBrandRamp(undefined).light.accentSolid).toBe('#f5b84c');
    expect(deriveBrandRamp('not-a-color').light.accentSolid).toBe('#f5b84c');
  });
});

describe('DEFAULT_BRAND_COLOR + bridge vars', () => {
  it('is the AuthOwl gold', () => {
    expect(DEFAULT_BRAND_COLOR).toBe('#F5B84C');
  });

  it('flattens to the 7 inline --ba-rt-* bridge vars styles.css routes', () => {
    const vars = brandRampVars(deriveBrandRamp(DEFAULT_BRAND_COLOR));
    expect(Object.keys(vars).sort()).toEqual(
      [
        '--ba-rt-accent-d',
        '--ba-rt-accent-fg',
        '--ba-rt-accent-l',
        '--ba-rt-solid-active-d',
        '--ba-rt-solid-active-l',
        '--ba-rt-solid-hover-d',
        '--ba-rt-solid-hover-l',
      ].sort(),
    );
    for (const v of Object.values(vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
