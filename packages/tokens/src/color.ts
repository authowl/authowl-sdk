/**
 * OKLCH colour math for the tokens: conversion to sRGB for fallbacks and the
 * WCAG 2 contrast ratio the tests and the Storybook page report. Written here
 * rather than pulled from a library so the package has no runtime dependencies.
 */

/** An OKLCH colour: lightness 0-1, chroma, hue in degrees, optional alpha 0-1. */
export type Oklch = { l: number; c: number; h: number; alpha?: number };

export function oklch(l: number, c: number, h: number, alpha?: number): Oklch {
  return alpha === undefined ? { l, c, h } : { l, c, h, alpha };
}

/** The colour as a CSS `oklch()` value. */
export function toCss({ l, c, h, alpha }: Oklch): string {
  const base = `${round(l, 4)} ${round(c, 4)} ${round(h, 2)}`;
  return alpha === undefined ? `oklch(${base})` : `oklch(${base} / ${round(alpha, 3)})`;
}

type Rgb = [number, number, number];

/** Linear sRGB channels, unclamped, so callers can tell when a colour is out of gamut. */
function toLinearRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** Whether the colour fits sRGB, the gamut every screen can show. */
export function inSrgbGamut(color: Oklch): boolean {
  return toLinearRgb(color).every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

/** The opaque sRGB hex the colour displays as (alpha is ignored). */
export function toHex(color: Oklch): string {
  return `#${toLinearRgb(color)
    .map((channel) => Math.round(clamp(encode(channel)) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** The OKLCH value of an sRGB hex, for converting approved design values. */
export function fromHex(hex: string): Oklch {
  const [r, g, b] = [1, 3, 5].map((i) => decode(parseInt(hex.slice(i, i + 2), 16) / 255)) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363288629 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c: C < 1e-4 ? 0 : C, h: H };
}

/** The colour seen when `top` (with its alpha) is painted over the opaque `bottom`. */
export function composite(top: Oklch, bottom: Oklch): Oklch {
  const alpha = top.alpha ?? 1;
  const over = toLinearRgb(top).map((channel, i) => {
    const t = encode(channel);
    const u = encode(toLinearRgb(bottom)[i]!);
    return decode(clamp(t * alpha + u * (1 - alpha)));
  });
  const hex = `#${over.map((x) => Math.round(clamp(encode(x)) * 255).toString(16).padStart(2, '0')).join('')}`;
  return fromHex(hex);
}

function luminance(color: Oklch): number {
  const [r, g, b] = toLinearRgb(color).map((channel) => decode(clamp(encode(channel))));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The WCAG 2 contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
