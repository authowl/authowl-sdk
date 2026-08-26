import { beforeEach, describe, expect, it } from 'vitest';
import { activeLocale, setActiveLocale } from './active-locale';

const projectA = '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60';
const projectB = '9f7707bf-778f-47e5-83bd-1ea903d5ee12';

beforeEach(() => {
  setActiveLocale(projectA, null);
  setActiveLocale(projectB, null);
});

describe('the language the application says it is rendering', () => {
  it('is remembered per project, not globally', () => {
    // Two providers for two projects on one page is unusual but legal, and a
    // single shared value would let one relabel the other's mail.
    setActiveLocale(projectA, 'ar');
    setActiveLocale(projectB, 'en');
    expect(activeLocale(projectA)).toBe('ar');
    expect(activeLocale(projectB)).toBe('en');
  });

  it('normalises case and whitespace', () => {
    setActiveLocale(projectA, '  AR ');
    expect(activeLocale(projectA)).toBe('ar');
  });

  it('is cleared when a provider unmounts', () => {
    setActiveLocale(projectA, 'ar');
    setActiveLocale(projectA, null);
    expect(activeLocale(projectA)).toBeNull();
  });

  /**
   * This becomes a header on every authenticated request, so the bound matters
   * more than the vocabulary: the server accepts only locales it has catalogues
   * for and ignores everything else, but an unbounded string would still be
   * sent on every call.
   */
  it.each([
    ['a full accept-language string', 'ar,en-US;q=0.9'],
    ['a region tag', 'ar-EG'],
    ['something long enough to be an attack', 'a'.repeat(4096)],
    ['a header injection attempt', 'ar\r\nX-Evil: 1'],
    ['an empty value', ''],
  ])('refuses %s rather than putting it on the wire', (_label, hostile) => {
    setActiveLocale(projectA, 'ar');
    setActiveLocale(projectA, hostile);
    // The previous good value stands; a bad one neither replaces nor clears it.
    expect(activeLocale(projectA)).toBe('ar');
  });

  it('reports nothing for a project that never set one', () => {
    expect(activeLocale('never-set')).toBeNull();
  });
});
