import { describe, expect, it } from 'vitest';
import type { PublicConfig } from '@authowl/core';
import { resolveAppearance } from './appearance';
import { makePublicConfig } from './test-fixtures';

const config = (branding: PublicConfig['branding']): PublicConfig =>
  makePublicConfig({ branding });

describe('resolveAppearance', () => {
  it('defaults to light with no --ba-primary when nothing is set', () => {
    const r = resolveAppearance(undefined, null);
    expect(r.theme).toBe('light');
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
    // The brand passes through verbatim; the ramp is added as --ba-rt-* bridges.
    expect(r.style['--ba-primary']).toBe('#F5B84C');
    for (const key of [
      '--ba-rt-solid-hover-l',
      '--ba-rt-solid-hover-d',
      '--ba-rt-solid-active-l',
      '--ba-rt-solid-active-d',
      '--ba-rt-accent-l',
      '--ba-rt-accent-d',
      '--ba-rt-accent-fg',
    ]) {
      expect(r.style[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Foreground on the gold fill is the dark option (white-on-gold is unreadable).
    expect(r.style['--ba-rt-accent-fg']).toBe('#18181b');
  });

  it('passes a non-hex CSS color through without a ramp (CSS fallback handles it)', () => {
    const r = resolveAppearance({ primaryColor: 'rebeccapurple' }, null);
    expect(r.style['--ba-primary']).toBe('rebeccapurple');
    expect(r.style['--ba-rt-accent-l']).toBeUndefined();
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
    expect(r.theme).toBe('light');
    expect(r.style).toEqual({});
  });
});
