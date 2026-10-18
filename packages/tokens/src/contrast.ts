import { composite, contrastRatio, type Oklch } from './color';
import { BRANDS, palette, SCHEMES, type Brand, type ColorToken, type Scheme } from './tokens';

/**
 * The foreground and background pairings the design uses, and the WCAG 2
 * minimum each must meet: 4.5 for text, 3 for focus rings and chart marks.
 * Anything not listed is not an approved pairing.
 */
export type ContrastPair = {
  fg: ColorToken;
  bg: ColorToken;
  /** A translucent `bg` (a soft tint) sits on this opaque token. */
  over?: ColorToken;
  min: 4.5 | 3;
};

const pairs = (min: ContrastPair['min']) => (fg: ColorToken, bgs: ColorToken[], over?: ColorToken): ContrastPair[] =>
  bgs.map((bg) => ({ fg, bg, over, min }));
const text = pairs(4.5);
const graphic = pairs(3);

const SURFACES: ColorToken[] = ['canvas', 'surface', 'raised', 'inset', 'highlight'];

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...text('fg', SURFACES),
  ...text('fg-muted', SURFACES),
  ...text('fg-faint', SURFACES),
  ...text('brand-text', ['canvas', 'surface', 'raised', 'highlight']),
  ...text('on-brand', ['brand', 'brand-hover']),
  ...text('success', ['canvas', 'surface', 'raised', 'highlight']),
  ...text('warning', ['canvas', 'surface', 'raised', 'highlight']),
  ...text('danger', ['canvas', 'surface', 'raised', 'highlight']),
  ...text('success', ['success-soft'], 'surface'),
  ...text('warning', ['warning-soft'], 'surface'),
  ...text('danger', ['danger-soft'], 'surface'),
  ...text('brand-text', ['brand-soft'], 'surface'),
  ...graphic('ring', ['canvas', 'surface', 'raised']),
  ...graphic('chart-1', ['surface']),
  ...graphic('chart-muted', ['surface']),
];

export type ContrastResult = ContrastPair & { brand: Brand; scheme: Scheme; ratio: number; passes: boolean };

/** Every approved pairing measured for every brand and scheme. */
export function measureContrast(): ContrastResult[] {
  return BRANDS.flatMap((brand) => SCHEMES.flatMap((scheme) => {
    const colors = palette(brand, scheme);
    return CONTRAST_PAIRS.map((pair) => {
      const background: Oklch = pair.over ? composite(colors[pair.bg], colors[pair.over]) : colors[pair.bg];
      const ratio = contrastRatio(colors[pair.fg], background);
      return { ...pair, brand, scheme, ratio, passes: ratio >= pair.min };
    });
  }));
}
