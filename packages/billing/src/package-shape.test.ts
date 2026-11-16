import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  sideEffects?: string[];
  exports?: Record<string, string | {
    import?: { types?: string; default?: string };
    require?: { types?: string; default?: string };
  }>;
};

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

function versionParts(value: string): readonly number[] {
  const matched = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!matched) throw new TypeError(`Invalid version ${value}.`);
  return matched.slice(1).map(Number);
}

function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

describe('billing package shape', () => {
  const billing = manifest(`${packageRoot}/package.json`);

  it('is public for the S13 first release', () => {
    expect(billing.private).toBeUndefined();
  });

  it('depends only on the workspace core package', () => {
    expect(billing.dependencies).toEqual({ '@authowl/core': 'workspace:*' });
  });

  it.each([
    ['@authowl/react', 'auth-react', '<2.0.0'],
    ['@authowl/next', 'auth-next', '<1.0.0'],
  ] as const)('keeps the %s peer range compatible with the workspace', (name, directory, upper) => {
    const sibling = manifest(`${workspaceRoot}/packages/${directory}/package.json`);
    const range = billing.peerDependencies?.[name];
    expect(range).toBeDefined();
    expect(range).toContain(upper);
    const lower = /^>=(\d+\.\d+\.\d+)/.exec(range ?? '')?.[1];
    expect(lower).toBeDefined();
    expect(compare(versionParts(lower!), versionParts(sibling.version))).toBeLessThanOrEqual(0);
  });

  it('keeps React optional and compatible with React 18', () => {
    expect(billing.peerDependencies?.react).toBe('>=18');
  });

  it('exports exactly the root, React, commerce, server and stylesheet entries', () => {
    expect(Object.keys(billing.exports ?? {})).toEqual([
      '.',
      './react',
      './react/commerce',
      './server',
      './styles.css',
    ]);
    for (const name of ['.', './react', './react/commerce', './server']) {
      const entry = billing.exports?.[name];
      if (typeof entry === 'string') throw new TypeError(`${name} must be conditional`);
      expect(Object.keys(entry ?? {}), name).toEqual(['import', 'require']);
      expect(Object.keys(entry?.import ?? {}), `${name} import`).toEqual(['types', 'default']);
      expect(Object.keys(entry?.require ?? {}), `${name} require`).toEqual(['types', 'default']);
    }
    expect(billing.exports?.['./styles.css']).toBe('./dist/styles.css');
    expect(billing.sideEffects).toEqual(['./dist/styles.css']);
  });

  it('keeps every framework peer optional', () => {
    expect(billing.peerDependenciesMeta).toEqual({
      '@authowl/next': { optional: true },
      '@authowl/react': { optional: true },
      react: { optional: true },
    });
  });
});
