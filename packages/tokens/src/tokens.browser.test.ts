import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { toCss } from './color';
import { shadcnCss, tokensCss } from './css';
import { brands, neutral } from './tokens';

const html = document.documentElement;

beforeAll(() => {
  // The generators' output is what build-css.mjs writes to dist byte for
  // byte; the packed dist itself goes through Tailwind in tokens-install-check.
  const style = document.createElement('style');
  // next/font's variable class, as Next.js generates it.
  style.textContent = `${tokensCss()}\n${shadcnCss()}\n.next-font { --font-geist-sans: 'NextFontGeist', 'NextFontGeist Fallback'; }`;
  document.head.append(style);
});

afterEach(() => {
  html.className = '';
  html.removeAttribute('data-brand');
  document.body.className = '';
  document.body.replaceChildren();
});

/** Mounts `markup` in the body and returns the element with `id="probe"`. */
function probe(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.getElementById('probe')!;
}

const read = (element: Element, name: string) => getComputedStyle(element).getPropertyValue(name).trim();

describe('brand and scheme scoping', () => {
  it('a dark container inside a branded page reads that brand in dark', () => {
    html.dataset.brand = 'billow';
    const element = probe('<div class="dark" id="probe"></div>');
    expect(read(element, '--primary')).toBe(toCss(brands.billow.dark.brand));
    expect(read(element, '--background')).toBe(toCss(neutral.dark.canvas));
    expect(read(html, '--primary')).toBe(toCss(brands.billow.light.brand));
  });

  it('a branded container inside a dark page reads that brand in dark', () => {
    html.className = 'dark';
    const element = probe('<div data-brand="billow" id="probe"></div>');
    expect(read(element, '--primary')).toBe(toCss(brands.billow.dark.brand));
    expect(read(element, '--background')).toBe(toCss(neutral.dark.canvas));
    expect(read(html, '--primary')).toBe(toCss(brands.authowl.dark.brand));
  });

  it('a container can switch back to the default brand', () => {
    const element = probe('<div data-brand="billow"><div data-brand="authowl" id="probe"></div></div>');
    expect(read(element, '--primary')).toBe(toCss(brands.authowl.light.brand));
    expect(read(element.parentElement!, '--primary')).toBe(toCss(brands.billow.light.brand));
  });

  it('an explicit brand on a dark element beats a brand around it', () => {
    const element = probe('<div data-brand="hitsend"><div data-brand="authowl" class="dark" id="probe"></div></div>');
    expect(read(element, '--primary')).toBe(toCss(brands.authowl.dark.brand));
  });

  it('a dark area takes the nearest brand, in either order of nesting', () => {
    for (const [outer, inner] of [['billow', 'authowl'], ['authowl', 'billow']] as const) {
      const element = probe(`<div data-brand="${outer}"><div data-brand="${inner}"><div class="dark" id="probe"></div></div></div>`);
      expect(read(element, '--primary'), `${inner} inside ${outer}`).toBe(toCss(brands[inner].dark.brand));
      expect(read(element, '--ring'), `${inner} inside ${outer}`).toBe(toCss(brands[inner].dark.ring));
    }
  });

  it('the scheme and the brand on <html> together', () => {
    html.className = 'dark';
    html.dataset.brand = 'hitsend';
    expect(read(html, '--primary')).toBe(toCss(brands.hitsend.dark.brand));
    expect(read(html, '--ring')).toBe(toCss(brands.hitsend.dark.ring));
    expect(read(html, '--background')).toBe(toCss(neutral.dark.canvas));
  });
});

describe('fonts', () => {
  const family = (element: Element) => getComputedStyle(element).fontFamily;
  const markup = '<p id="probe" style="font-family: var(--ao-font-sans)">Sign in</p>';

  it('reads next/font from a class on <html>', () => {
    html.className = 'next-font';
    expect(family(probe(markup))).toMatch(/^"?NextFontGeist"?,/);
  });

  it('reads next/font from a class on <body>', () => {
    document.body.className = 'next-font';
    expect(family(probe(markup))).toMatch(/^"?NextFontGeist"?,/);
  });

  it('falls back to Geist without next/font', () => {
    expect(family(probe(markup))).toMatch(/^Geist,/);
  });
});
