import { describe, expect, it } from 'vitest';
import type { PublicConfig } from '@authowl/core';
import { resolveAppearance } from './appearance';
import { makePublicConfig } from './test-fixtures';

const config = (branding: PublicConfig['branding']): PublicConfig =>
  makePublicConfig({ branding });

describe('resolveAppearance', () => {
  it('defaults to inherit with no --ba-primary when nothing is set', () => {
    const r = resolveAppearance(undefined, null);
    expect(r.theme).toBe('inherit');
    expect(r.primaryColor).toBeUndefined();
    expect(r.style).toEqual({});
  });

  it('uses fetched branding when no prop is given', () => {
    const r = resolveAppearance(undefined, config({ theme: 'dark', primaryColor: '#0EA5A4' }));
    expect(r.theme).toBe('dark');
    expect(r.primaryColor).toBe('#0EA5A4');
    expect(r.style['--ba-primary']).toBe('#0EA5A4');
  });

  it('emits the derived accent ramp bridge vars for a hex brand color', () => {
    const r = resolveAppearance({ primaryColor: '#F5B84C' }, null);
    // The brand passes through verbatim; the ramp is added as --ao-* scheme variables.
    expect(r.style['--ba-primary']).toBe('#F5B84C');
    for (const key of [
      '--ao-light-brand-hover',
      '--ao-dark-brand-hover',
      '--ao-light-brand-active',
      '--ao-dark-brand-active',
      '--ao-light-brand-text',
      '--ao-dark-brand-text',
      '--ao-light-on-brand',
    ]) {
      expect(r.style[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Foreground on the gold fill is the dark option (white-on-gold is unreadable).
    expect(r.style['--ao-light-on-brand']).toBe('#18181b');
  });

  it('emits complete ramps for a supported named primary color', () => {
    const r = resolveAppearance({ primaryColor: 'rebeccapurple' }, null);
    expect(r.style['--ba-primary']).toBe('#663399');
    expect(r.style['--ao-light-brand']).toBe('#663399');
    expect(r.style['--ao-light-brand-active']).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('lets the appearance prop override branding', () => {
    const r = resolveAppearance(
      { theme: 'light', primaryColor: '#ff0000' },
      config({ theme: 'dark', primaryColor: '#0EA5A4' }),
    );
    expect(r.theme).toBe('light');
    expect(r.style['--ba-primary']).toBe('#ff0000');
  });

  it('fills each field independently (prop theme + branding color)', () => {
    const r = resolveAppearance({ theme: 'dark' }, config({ primaryColor: '#123456' }));
    expect(r.theme).toBe('dark');
    expect(r.style['--ba-primary']).toBe('#123456');
  });

  it('passes the raw theme through (system is resolved by CSS, not here)', () => {
    expect(resolveAppearance({ theme: 'system' }, null).theme).toBe('system');
  });

  it('does not crash when a 200 config omits branding', () => {
    // getPublicConfig casts without validation; a partial payload must degrade,
    // not throw during render.
    const partial = { enabledMethods: ['password'] } as unknown as PublicConfig;
    const r = resolveAppearance(undefined, partial);
    expect(r.theme).toBe('inherit');
    expect(r.style).toEqual({});
  });
});

describe('appearance variables and brands', () => {
  it('emits variables synchronously and prefers colorPrimary over its legacy alias', () => {
    const r = resolveAppearance({ brand: 'billow', primaryColor: '#ffffff', variables: {
      colorPrimary: '#123456', colorBackground: '#eeeeee', borderRadius: '9px',
      controlHeight: '2rem', fontFamily: 'Arial',
    } }, config({ theme: 'dark', primaryColor: '#000000' }));
    expect(r.brand).toBe('billow');
    expect(r.theme).toBe('dark');
    expect(r.style).toMatchObject({ '--ba-primary': '#123456', '--ao-light-brand': '#123456',
      '--ao-dark-brand': '#123456', '--ao-surface': '#eeeeee', '--ao-border-radius': '9px',
      '--ao-control-height': '2rem', '--ao-font-family': 'Arial' });
  });
  it('lets an explicit brand replace the dashboard color without emitting inline ramps', () => {
    expect(resolveAppearance({ brand: 'hitsend', theme: 'inherit' }, config({ theme: 'dark', primaryColor: '#000000' })))
      .toMatchObject({ brand: 'hitsend', theme: 'inherit', style: {} });
  });
});

it.each(['#abc', 'rgb(14, 165, 164)', 'rgb(5% 65% 64%)', 'hsl(180 80% 35%)', 'oklch(0.51 0.23 277)', 'white'])('derives the complete primary ramp for %s', primary => {
  const { style } = resolveAppearance({ brand: 'billow', variables: { colorPrimary: primary } }, null);
  for (const scheme of ['light', 'dark']) {
    for (const token of ['brand', 'brand-hover', 'brand-active', 'on-brand', 'brand-text', 'ring']) {
      expect(style[`--ao-${scheme}-${token}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
  }
});

it.each(['transparent', 'currentColor', 'rgb(1 2 3 / .5)', 'color(display-p3 1 0 0)', 'hsl(1 2 3)', 'oklch(2 0 0)'])('rejects unsupported primary %s atomically', primaryColor => {
  expect(resolveAppearance({ primaryColor }, null).style).toEqual({});
});

it.each(['2rem', '32px', '100%', 'calc(2rem + 4px)'])('accepts one length expression %s', controlHeight => {
  expect(resolveAppearance({ variables: { controlHeight } }, null).style['--ao-control-height']).toBe(controlHeight);
});

it.each(['2rem 3rem', 'auto', 'calc(2rem + red)', 'var(--height)', '32'])('rejects invalid length %s', controlHeight => {
  expect(resolveAppearance({ variables: { controlHeight } }, null).style).toEqual({});
});

it('chooses an AA label for white on Billow and matching OKLCH active colours', async () => {
  const { contrastRatio, deriveBrandRamp, parseColor } = await import('./brand');
  const white = resolveAppearance({ brand: 'billow', variables: { colorPrimary: 'white' } }, null).style;
  expect(contrastRatio(white['--ao-light-brand']!, white['--ao-light-on-brand']!)).toBeGreaterThanOrEqual(4.5);
  const primaryColor = 'oklch(0.51 0.23 277)';
  const result = resolveAppearance({ primaryColor }, null).style;
  const ramp = deriveBrandRamp(parseColor(primaryColor));
  expect(result['--ao-light-brand-active']).toBe(ramp.light.accentSolidActive);
  expect(result['--ao-dark-brand-active']).toBe(ramp.dark.accentSolidActive);
  expect(result['--ba-primary']).toBe(ramp.light.accentSolid);
});

it.each([
  ['#abc', '#aabbcc'], ['rgb(255, 0, 0)', '#ff0000'], ['hsl(120deg 100% 50%)', '#00ff00'],
  ['hsl(240, 100%, 50%)', '#0000ff'], ['oklch(100% 0 0)', '#ffffff'],
])('normalizes %s consistently without browser APIs', async (input, hex) => {
  const { parseColor } = await import('./brand');
  expect(parseColor(input)).toBe(hex);
});
