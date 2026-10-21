import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { neutral, toHex } from '@authowl/tokens';
import { contrastRatio } from './brand';
import { slot } from './elements';

describe('published palette contract (run build first)', () => {
  it('never imports the build-only tokens package at runtime', () => {
    const root = new URL('./', import.meta.url);
    const sources = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(file => file.isFile() && /\.tsx?$/.test(file.name) && !/\.test\./.test(file.name));
    for (const file of sources) {
      const source = readFileSync(`${file.parentPath}/${file.name}`, 'utf8');
      expect(source).not.toContain('@authowl/tokens');
    }
  });
  it('ships scoped tokens and selectors with legacy reads only', () => {
    const css = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
    expect(css).not.toContain(':root');
    expect(css).not.toMatch(/--ba-[\w-]+\s*:/);
    expect(css).not.toMatch(/\.ba-[\w-]+/);
    expect(css).toContain(".authowl-root[data-authowl-brand='billow']");
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
    expect(slot('error')).toBe('ao-error ba-error');
    expect(slot('input', { input: 'host-input rounded-none' })).toBe('ao-input ba-input host-input rounded-none');
  });
});
