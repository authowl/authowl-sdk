import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
const sources = sourceFiles(sourceRoot)
  .filter((name) => !name.endsWith('.test.ts')
    && !name.endsWith('.test.tsx')
    && !name.endsWith('test-fixtures.ts'))
  .map((name) => [relative(sourceRoot, name), readFileSync(name, 'utf8')] as const);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('billing source policy', () => {
  it('uses only the public core client extension', () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(
        /resolveConfig|createAuthOwlClient|requestPublishableJson|session-token|auth-core\/src/,
      );
    }
  });

  it('keeps only the React entry client and framework-specific', () => {
    for (const [name, source] of sources) {
      if (name === 'react.tsx') {
        expect(source.startsWith("'use client';\n"), name).toBe(true);
      } else {
        expect(source, name).not.toContain("'use client'");
        expect(source, name).not.toMatch(/from ['"]react['"]/);
      }
    }
  });

  it('isolates the server entry and its framework imports', () => {
    const server = sources.find(([name]) => name === 'server.ts')?.[1];
    expect(server).toBeDefined();
    const imports = [...server!.matchAll(/from ['"]([^'"]+)['"]/g)]
      .map((match) => match[1]);
    expect(new Set(imports)).toEqual(new Set([
      '@authowl/core/server',
      '@authowl/next/server',
      './store',
      './wire',
    ]));

    for (const [name, source] of sources) {
      if (name === 'server.ts') continue;
      expect(source, name).not.toMatch(
        /['"]\.\/server(?:\.js)?['"]|@authowl\/next|@authowl\/core\/server/,
      );
    }
  });

  it('does not add zod to the browser source', () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/from ['"]zod['"]/);
    }
  });
});
