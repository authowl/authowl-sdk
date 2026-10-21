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

// Strict structural check before CSSOM, which can silently discard invalid rules.
function validateSelector(selector: string): void {
  const stack: string[] = [];
  let quote = '';
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]!;
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') stack.push(char);
    if (char === ')' || char === ']') {
      if (stack.pop() !== (char === ')' ? '(' : '[')) throw new Error(`Unbalanced selector: ${selector}`);
    }
  }
  if (quote || stack.length) throw new Error(`Unbalanced selector: ${selector}`);
  for (const item of selectorList(selector)) {
    if (!item.trim() || /^[>+~]|[>+~]$/.test(item.trim())) throw new Error(`Dangling combinator: ${selector}`);
  }
  // Validate each functional selector's branches too, including nested :is/:where.
  const functions = /:(?:where|is|not)\(/g;
  while (functions.exec(selector)) {
    let end = functions.lastIndex;
    let depth = 1;
    for (; depth && end < selector.length; end++) {
      if (selector[end] === '(') depth++;
      if (selector[end] === ')') depth--;
    }
    validateSelector(selector.slice(functions.lastIndex, end - 1));
    functions.lastIndex = end;
  }
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

function sourceSelectors(): string[] {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return Array.from(source.matchAll(/([^{}]+)\{/g)).flatMap((match) => {
    const header = match[1]!.trim();
    return header.startsWith('@') || /^(?:from|to|[\d.]+%)(?:\s*,|$)/.test(header)
      ? [] : selectorList(header).map((selector) => selector.trim());
  });
}

function hasClassOutsideWhere(selector: string): boolean {
  const tokens = /:where\(|\.[\w-]+|\[[^\]]*\]/g;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(selector))) {
    if (token[0].startsWith('.')) return true;
    if (token[0] !== ':where(') continue;
    let depth = 1;
    while (depth && tokens.lastIndex < selector.length) {
      const char = selector[tokens.lastIndex++];
      if (char === '(') depth++;
      if (char === ')') depth--;
    }
  }
  return false;
}

function assertBareElementFloor(selector: string): void {
  // Find the subject without treating spaces inside :where() or attributes
  // as descendant combinators. Attributes and pseudos can qualify a bare tag.
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]!;
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(char)) start = i + 1;
  }
  const subject = selector.slice(start);
  if (!/^[a-z][\w-]*(?:$|\[|:)/i.test(subject)) return;
  expect(compare(specificity(selector), [0, 0, 1]), selector).toBeGreaterThan(0);
  expect(hasClassOutsideWhere(selector), selector).toBe(true);
}

// Legacy rules and bare descendants retain a class floor above host resets.
// Class-targeted selectors stay at or below one class. Each exception is exact.
const LEGACY_EXCEPTIONS: Record<string, string> = {
  ":where(.authowl-root) .ao-passkey-info strong": "Bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-factor-subtitle strong": "Bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-identity-copy strong": "Bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-identity-copy small": "Bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-modal-header h1": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-modal-header p": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-section input[type='email']": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-section input[inputmode='url']": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-current span": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-status span": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-recovery-card p": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-recovery-card bdi": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-profile-close svg": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root)[dir='rtl'] .ao-profile button": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root)[dir='rtl'] .ao-profile input": "Pre-existing bare-element styling must override host element resets.",
  ":where(.authowl-root) .ao-input:focus": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-button:not(.ao-button-secondary):not(.ao-danger-button):hover:not(:disabled)": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-button:not(.ao-button-secondary):not(.ao-danger-button):active:not(:disabled)": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-button:disabled": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-button-secondary:hover:not(:disabled)": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-hosted-frame iframe": "Pre-existing hosted verification iframe sizing.",
  ":where(.authowl-root) .ao-auth-challenge .ao-turnstile": "Pre-existing challenge container layout for Turnstile.",
  ":where(.authowl-root) .ao-consent a": "Pre-existing legal consent link styling.",
  ":where(.authowl-root) .ao-checkbox:checked + .ao-checkbox-visual": "Pre-existing checkbox state styles target the adjacent visual control.",
  ":where(.authowl-root) .ao-checkbox:checked + .ao-checkbox-visual .ao-checkbox-check": "Pre-existing checkbox state styles target the adjacent visual control.",
  ":where(.authowl-root) .ao-checkbox:focus-visible + .ao-checkbox-visual": "Pre-existing checkbox state styles target the adjacent visual control.",
  ":where(.authowl-root) .ao-checkbox:disabled + .ao-checkbox-visual": "Pre-existing checkbox state styles target the adjacent visual control.",
  ":where(.authowl-root) .ao-privacy-signup-header h3": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-signup-header p": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-notice summary": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-notice p": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-purpose-list legend": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-purpose > span:last-child": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-purpose strong": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-purpose small": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-branding-link:hover .ao-branding-name": "Pre-existing branding descendant and hover styling.",
  ":where(.authowl-root) .ao-environment-development .ao-environment-dot": "Pre-existing branding descendant and hover styling.",
  ":where(.authowl-root) .ao-badge:hover": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-link-button:disabled": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-link-button.ao-danger": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-backup-codes .ao-code": "Pre-existing backup-code container styles its code children.",
  ":where(.authowl-root) .ao-divider::before": "Pre-existing divider pseudo-element styling.",
  ":where(.authowl-root) .ao-divider::after": "Pre-existing divider pseudo-element styling.",
  ":where(.authowl-root) .ao-menu-item:hover": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-privacy-center-block + .ao-privacy-center-block": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-center-block-heading h3": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-center-block-heading p": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-center-choice > span": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-center-choice strong": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-center-choice small": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-toggle > span": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-toggle > span::after": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-toggle[aria-checked='true'] > span": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-toggle[aria-checked='true'] > span::after": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root)[dir='rtl'] .ao-privacy-toggle[aria-checked='true'] > span::after": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-toggle b": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-toggle:focus-visible": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-toggle:disabled": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-right:hover:not(:disabled)": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-right:disabled": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-request-list li": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-request-list li > span": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-request-list strong": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-request-list small": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-request-list li > b": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-privacy-request-list li > b[data-state='completed']": "Pre-existing privacy surface descendant and state styling.",
  ":where(.authowl-root) .ao-danger-button:hover:not(:disabled)": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-menu-badge .ao-badge": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-menu-badge:empty": "Pre-existing control variant or interaction-state styling.",
  ":where(.authowl-root) .ao-organization-switcher-trigger > span:nth-child(2)": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-menu-item:hover": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-menu-item[aria-current='true']": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-menu-item > span:nth-child(2)": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-menu-item small": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-menu-actions .ao-menu-item": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-invitation-panel .ao-title": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-modal-header .ao-title": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-section-header .ao-title": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-section-header .ao-muted": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-directory-header h2": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-directory-header p": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-card-grid > .ao-skeleton": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-card-copy strong": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-card-copy small": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-member:last-child": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-invitation:last-child": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-invitation > span:first-child": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-member-copy small": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-invitation small": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-profile-heading h2": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-profile-heading p": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-facts div": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-facts dt": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-facts dd": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-invite-form .ao-label": "Pre-existing organization surface descendant and state styling.",
  ":where(.authowl-root) .ao-organization-danger-action > p": "Pre-existing organization surface descendant and state styling.",
  ".authowl-root[dir='rtl'] .ao-form": "Pre-existing RTL font override for host and native control fonts.",
  ".authowl-root[dir='rtl'] .ao-menu": "Pre-existing RTL font override for host and native control fonts.",
  ".authowl-root[dir='rtl'] .ao-input": "Pre-existing RTL font override for host and native control fonts.",
  ".authowl-root[dir='rtl'] .ao-button": "Pre-existing RTL font override for host and native control fonts.",
  ".authowl-root[dir='rtl'] .ao-link-button": "Pre-existing RTL font override for host and native control fonts.",
  ".authowl-root[dir='rtl'] .ao-organization-switcher-trigger": "Pre-existing RTL font override for host and native control fonts.",
  ".authowl-root[dir='rtl'] .ao-organization-menu-item": "Pre-existing RTL font override for host and native control fonts.",
};

describe('authentication stylesheet specificity', () => {
  it('rejects malformed selectors before the browser can discard them', () => {
    for (const bad of [':where(.authowl-root .ao-profile-list +)', '.one >', '+ .one', ':where(.one', ':is(.one))']) {
      expect(() => validateSelector(bad), bad).toThrow();
    }
  });

  it('validates every source selector, including rules discarded by CSSOM', () => {
    for (const selector of sourceSelectors()) {
      expect(() => validateSelector(selector), selector).not.toThrow();
    }
  });
  it('measures functional selectors using CSS specificity rules', () => {
    expect(specificity(':where(.authowl-root .ao-auth-card) .ao-input')).toEqual([0, 1, 0]);
    expect(specificity(':where(.authowl-root) .ao-auth-card .ao-input')).toEqual([0, 2, 0]);
    expect(specificity(':is(.one, #two) > button:not(:disabled)')).toEqual([1, 1, 1]);
    expect(specificity(':where(.root :is(.one, #two)) .tab:where(:focus-visible)')).toEqual([0, 1, 0]);
  });

  it('keeps bare-element rules above a host preflight element selector', () => {
    for (const selector of sourceSelectors()) assertBareElementFloor(selector);
  });

  it('rejects new bare-element subjects whose class floor is hidden in :where', () => {
    expect(() => assertBareElementFloor(':where(.authowl-root .ao-x) strong')).toThrow();
    expect(() => assertBareElementFloor(':where(.authowl-root .ao-x) input[type="email"]')).toThrow();
    expect(() => assertBareElementFloor(':where(.authowl-root) .ao-x strong')).not.toThrow();
  });

  it('caps every source selector at one class except documented legacy rules', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');
    document.head.append(style);
    try {
      const sourceSelectors = selectors(style.sheet!.cssRules).map((selector) => selector.trim());
      for (const selector of sourceSelectors) {
        if (LEGACY_EXCEPTIONS[selector]) continue;
        expect(compare(specificity(selector), [0, 1, 0]), selector).toBeLessThanOrEqual(0);
      }
      for (const selector of Object.keys(LEGACY_EXCEPTIONS)) {
        expect(sourceSelectors, `Remove stale exception: ${selector}`).toContain(selector);
      }
    } finally {
      style.remove();
    }
  });
});
