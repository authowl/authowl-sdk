// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Specificity = [number, number, number];
const compare = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Split selector lists only at the top level, preserving functional selectors.
function selectorList(text: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '[') depth++;
    else if (text[i] === ')' || text[i] === ']') depth--;
    else if (text[i] === ',' && depth === 0) { result.push(text.slice(start, i)); start = i + 1; }
  }
  result.push(text.slice(start));
  return result;
}

function specificity(selector: string): Specificity {
  const value: Specificity = [0, 0, 0];
  const tokens = /(:[\w-]+)\(|(\[[^\]]*\])|(::[\w-]+)|([.#:][\w-]+)|([\w-]+)/g;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(selector))) {
    if (token[1]) {
      let depth = 1;
      const start = tokens.lastIndex;
      let end = start;
      while (depth && end < selector.length) {
        if (selector[end] === '(') depth++;
        if (selector[end] === ')') depth--;
        end++;
      }
      const name = token[1];
      if ([':is', ':not', ':has'].includes(name)) {
        const highest = selectorList(selector.slice(start, end - 1)).map(specificity).sort(compare).at(-1)!;
        highest.forEach((part, i) => { value[i]! += part; });
      } else if (name !== ':where') {
        value[1]++;
      }
      tokens.lastIndex = end;
    } else if (token[2]) value[1]++;
    else if (token[3]) value[2]++;
    else if (token[4]) value[token[4].startsWith('#') ? 0 : 1]++;
    else value[2]++;
  }
  return value;
}

function selectors(rules: CSSRuleList): string[] {
  return Array.from(rules).flatMap((rule) => {
    if ('selectorText' in rule) return selectorList((rule as CSSStyleRule).selectorText);
    if ('cssRules' in rule) return selectors((rule as CSSGroupingRule).cssRules);
    return [];
  });
}

describe('authentication stylesheet specificity', () => {
  it('measures functional selectors using CSS specificity rules', () => {
    expect(specificity(':where(.authowl-root .ao-auth-card) .ao-input')).toEqual([0, 1, 0]);
    expect(specificity(':where(.authowl-root) .ao-auth-card .ao-input')).toEqual([0, 2, 0]);
    expect(specificity(':is(.one, #two) > button:not(:disabled)')).toEqual([1, 1, 1]);
    expect(specificity(':where(.root :is(.one, #two)) .tab:where(:focus-visible)')).toEqual([0, 1, 0]);
  });

  it('lets host class overrides beat every card, header, tab and social selector', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../dist/styles.css'), 'utf8');
    document.head.append(style);
    try {
      const protectedSelectors = selectors(style.sheet!.cssRules).filter((selector) => /\.ao-(?:auth-card|auth-header|tab|method-tab|social)/.test(selector));
      expect(protectedSelectors.length).toBeGreaterThan(40);
      for (const selector of protectedSelectors) {
        expect(compare(specificity(selector), [0, 1, 0]), selector).toBeLessThanOrEqual(0);
      }
    } finally {
      style.remove();
    }
  });
});
