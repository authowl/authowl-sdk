import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { richMessage } from './index';
import { resolveLocale } from '../provider';

/** Flatten richMessage output into a readable shape for assertions. */
function parts(result: React.ReactNode): (string | { slot: true })[] {
  return (result as React.ReactNode[]).map((node) =>
    React.isValidElement(node) ? { slot: true as const } : String(node),
  );
}

describe('richMessage', () => {
  it('injects a node at the {token} position (start / middle / end)', () => {
    const slot = <b>X</b>;
    expect(parts(richMessage('Hello {name}!', { name: slot }))).toEqual([
      'Hello ',
      { slot: true },
      '!',
    ]);
    expect(parts(richMessage('{name} leads', { name: slot }))).toEqual([{ slot: true }, ' leads']);
    expect(parts(richMessage('ends with {name}', { name: slot }))).toEqual([
      'ends with ',
      { slot: true },
    ]);
  });

  it('leaves unknown tokens visible as text (reviewable, never dropped)', () => {
    expect(parts(richMessage('Hi {missing}!', {}))).toEqual(['Hi ', '{missing}', '!']);
  });

  it('handles adjacent tokens', () => {
    const a = <i>a</i>;
    const b = <i>b</i>;
    expect(parts(richMessage('{first}{second}', { first: a, second: b }))).toEqual([
      { slot: true },
      { slot: true },
    ]);
  });
});

describe('resolveLocale (provider precedence)', () => {
  it('explicit valid prop wins over everything', () => {
    expect(resolveLocale('ar', null, 'en')).toBe('ar');
  });
  it('invalid prop falls through to the config default, never crashes', () => {
    expect(resolveLocale('fr' as never, null, 'ar')).toBe('ar');
    expect(resolveLocale('fr' as never, null, undefined)).toBe('en');
  });
  it("'auto' uses the post-mount detection, 'en' until it resolves", () => {
    expect(resolveLocale('auto', 'ar', 'en')).toBe('ar');
    expect(resolveLocale('auto', null, 'ar')).toBe('en');
  });
  it('no prop: the server default from public-config, guarded', () => {
    expect(resolveLocale(undefined, null, 'ar')).toBe('ar');
    expect(resolveLocale(undefined, null, 'fr')).toBe('en');
    expect(resolveLocale(undefined, null, undefined)).toBe('en');
  });
});
