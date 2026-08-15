import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentsRoot = join(dirname(fileURLToPath(import.meta.url)), 'components');

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.isFile() && path.endsWith('.tsx') ? [path] : [];
  });
}

describe('form fallback security', () => {
  it('uses POST for every SDK form before hydration', () => {
    const missingMethod = componentFiles(componentsRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return /<form\b(?![^>]*\bmethod=)[^>]*>/s.test(source) ? [path] : [];
    });

    expect(missingMethod).toEqual([]);
  });
});
