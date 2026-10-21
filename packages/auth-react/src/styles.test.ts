import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { neutral, toHex } from '@authowl/tokens';
import { contrastRatio } from './brand';
import { ELEMENT_SLOTS, slot } from './elements';

describe('published palette contract (run build first)', () => {
  it('never imports the build-only tokens package at runtime', () => {
    const js = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
    expect(js).not.toContain('@authowl/tokens');
    expect(js).not.toContain('tokensCss');
  });
  it('ships scoped tokens and selectors with legacy reads only', () => {
    const css = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
    expect(css).not.toContain(':root');
    expect(css).not.toMatch(/--ba-[\w-]+\s*:/);
    expect(css).not.toMatch(/\.ba-[\w-]+/);
    expect(css).toContain(".authowl-root[data-brand='billow']");
    expect(css).toContain(".dark .authowl-root[data-authowl-theme='inherit']");
    expect(css).toContain('var(--ba-surface, var(--ao-surface))');
    expect(css).toContain('var(--ba-danger-text, var(--ao-danger-text))');
  });
  it('uses an AA danger colour on every SDK token surface', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const surface of ['canvas', 'surface', 'raised', 'inset', 'highlight'] as const) {
        expect(contrastRatio(toHex(neutral[scheme].danger), toHex(neutral[scheme][surface]))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('gives every typed slot both names and appends host classes', () => {
    for (const name of ELEMENT_SLOTS) expect(slot(name)).toBe(`ao-${name} ba-${name}`);
    expect(slot('input', { input: 'host-input rounded-none' })).toBe('ao-input ba-input host-input rounded-none');
  });
});
