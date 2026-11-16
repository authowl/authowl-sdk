import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type VariableRead = Readonly<{
  name: string;
  hasFallback: boolean;
}>;

function defaultDefinitions(css: string): Set<string> {
  const defaults = new Set<string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.split(',').map((selector) => selector.trim());
    if (!selectors.includes(':root') && !selectors.includes('.authowl-root')) continue;
    for (const declaration of rule[2]!.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
      defaults.add(declaration[1]!);
    }
  }
  return defaults;
}

function variableReads(css: string): VariableRead[] {
  const reads: VariableRead[] = [];
  let searchFrom = 0;
  while (true) {
    const start = css.indexOf('var(', searchFrom);
    if (start === -1) return reads;
    let depth = 1;
    let cursor = start + 4;
    let commaAtTopLevel = false;
    for (; cursor < css.length && depth > 0; cursor += 1) {
      const character = css[cursor];
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 1) commaAtTopLevel = true;
    }
    const body = css.slice(start + 4, cursor - 1);
    const name = /^\s*(--[a-z0-9-]+)/i.exec(body)?.[1];
    if (name) reads.push({ name, hasFallback: commaAtTopLevel });
    searchFrom = start + 4;
  }
}

describe('billing stylesheet token contract', () => {
  it('gives every non-default variable an explicit fallback', async () => {
    const billingCss = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const tokenModule = await import(new URL('../../tokens/src/css.ts', import.meta.url).href) as {
      tokensCss(): string;
    };
    const tokenCss = tokenModule.tokensCss();
    const authCss = readFileSync(new URL('../../auth-react/src/styles.css', import.meta.url), 'utf8');
    const defaults = new Set([
      ...defaultDefinitions(tokenCss),
      ...defaultDefinitions(authCss),
    ]);
    const unsafe = variableReads(billingCss)
      .filter((read) => !read.hasFallback && !defaults.has(read.name));

    expect(variableReads('color: var(--missing); color: var(--optional, red)'))
      .toEqual([
        { name: '--missing', hasFallback: false },
        { name: '--optional', hasFallback: true },
      ]);
    expect(defaults.has('--ao-fg')).toBe(true);
    expect(defaults.has('--ao-control-height')).toBe(false);
    expect(defaults.has('--ao-border-radius')).toBe(false);
    expect(unsafe).toEqual([]);
  });
});
