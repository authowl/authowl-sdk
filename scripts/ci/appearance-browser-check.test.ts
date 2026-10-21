import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { neutral, toCss } from '@authowl/tokens';
import { AuthOwlProvider } from '../../packages/auth-react/src/provider';
import { OtpCodeForm } from '../../packages/auth-react/src/components/OtpCodeForm';
import type { Appearance } from '../../packages/auth-react/src/appearance';
import { contrastRatio, parseColor } from '../../packages/auth-react/src/brand';

let browser: Browser;
let page: Page;
const css = readFileSync(new URL('../../packages/auth-react/dist/styles.css', import.meta.url), 'utf8');
const hostTokens = readFileSync(new URL('../../packages/tokens/dist/tokens.css', import.meta.url), 'utf8');
beforeAll(async () => { browser = await chromium.launch({ channel: 'chromium' }); page = await browser.newPage(); });
afterAll(async () => { await browser?.close(); });
const noop = () => {};
function markup(appearance?: Appearance) {
  return renderToString(createElement(AuthOwlProvider, {
    publishableKey: 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789',
    apiUrl: 'https://auth.example.com', appearance,
    children: createElement(OtpCodeForm, { email: 'a@example.com', code: '', onCodeChange: noop,
      onSubmit: noop, onChangeEmail: noop, pending: false, error: 'Wrong code' }),
  }));
}
async function mount(appearance?: Appearance, host = '', dark = false) {
  await page.setContent(`<style>${css}\n${hostTokens}\n${host}</style><main class="${dark ? 'dark' : ''}">${markup(appearance)}</main>`);
}
async function color(selector: string, property = 'color') {
  return page.locator(selector).evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

it('applies the danger token to rendered FormError and preserves both class names', async () => {
  for (const theme of ['light', 'dark'] as const) {
    await mount({ theme });
    await expect(page.locator('.ao-error.ba-error').count()).resolves.toBe(1);
    await expect(page.locator('.ao-input.ba-input').count()).resolves.toBe(1);
    await expect(page.locator('.ao-button.ba-button').count()).resolves.toBe(1);
    const expected = await page.evaluate(value => {
      const el = document.createElement('p'); el.style.color = value; document.body.append(el);
      const result = getComputedStyle(el).color; el.remove(); return result;
    }, toCss(neutral[theme].danger));
    expect(await color('.ao-error')).toBe(expected);
  }
});

it('resolves light, dark, system and inherit on the SDK root only', async () => {
  await mount({ theme: 'light' }, '', true);
  const light = await color('.ao-input', 'background-color');
  await mount({ theme: 'dark' });
  const dark = await color('.ao-input', 'background-color');
  expect(dark).not.toBe(light);
  for (const os of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: os });
    await mount({ theme: 'system' }, '', os === 'light');
    expect(await color('.ao-input', 'background-color')).toBe(os === 'light' ? light : dark);
  }
  for (const hostDark of [false, true]) {
    await mount({ theme: 'inherit' }, '', hostDark);
    await page.locator('html').evaluate(el => el.setAttribute('data-authowl-theme', 'dark'));
    expect(await color('.ao-input', 'background-color')).toBe(hostDark ? dark : light);
    await page.locator('html').evaluate(el => el.removeAttribute('data-authowl-theme'));
  }
});

it('keeps default input geometry with and without a host border-box reset', async () => {
  // The original input declarations before slice (b), independent of new rules.
  const original = '.before { padding:8px 10px; border:1px solid black; border-radius:6px; font-size:14px; }';
  for (const reset of ['', '* { box-sizing:border-box; }']) {
    await mount(undefined, `${reset}\n${original}`);
    await page.locator('main').evaluate(el => { el.innerHTML += '<label style="display:flex;flex-direction:column"><input class="before"></label>'; });
    const geometry = (el: Element) => {
      const s = getComputedStyle(el);
      return [s.boxSizing, s.height, s.padding, s.borderWidth, s.minHeight];
    };
    expect(await page.locator('.ao-input').evaluate(geometry)).toEqual(await page.locator('.before').evaluate(geometry));
    await mount({ variables: { controlHeight: '2rem' } }, reset);
    expect(await color('.ao-input', 'box-sizing')).toBe('border-box');
    expect(await color('.ao-input', 'height')).toBe('32px');
  }
});

it('derives legacy primary-only hover, active, accent and focus before brand fallback', async () => {
  for (const theme of ['light', 'dark'] as const) {
    await mount({ theme }, '.authowl-root { --ba-primary: #0000ff; }');
    const button = page.locator('.ao-button');
    expect(await color('.ao-button', 'background-color')).toBe('rgb(0, 0, 255)');
    await button.hover();
    const hover = await color('.ao-button', 'background-color');
    await page.mouse.down();
    const active = await color('.ao-button', 'background-color');
    await page.mouse.up();
    const expectedStates = await page.evaluate(scheme => {
      const el = document.createElement('p'); document.body.append(el);
      const values = (scheme === 'light' ? [90, 84] : [80, 65]).map(percent => {
        el.style.color = `color-mix(in oklab, #0000ff ${percent}%, ${scheme === 'light' ? 'black' : 'white'})`;
        return getComputedStyle(el).color;
      });
      el.remove(); return values;
    }, theme);
    expect([hover, active]).toEqual(expectedStates);
    const expected = await page.evaluate(scheme => {
      const el = document.createElement('p'); el.style.color = `color-mix(in oklab, #0000ff ${scheme === 'light' ? '65%' : '80%'}, ${scheme === 'light' ? 'black' : 'white'})`;
      document.body.append(el); const result = getComputedStyle(el).color; el.remove(); return result;
    }, theme);
    expect(await color('.ao-link-button')).toBe(expected);
    await page.locator('.ao-input').focus();
    expect(await color('.ao-input', 'outline-color')).toBe(expected);
  }
});

it.each(['white', 'rgb(14, 165, 164)', 'hsl(180 80% 35%)', 'oklch(0.51 0.23 277)'])('applies a complete readable primary ramp in a tokens host: %s', primary => {
  return (async () => {
    await mount({ brand: 'billow', variables: { colorPrimary: primary } });
    const fill = parseColor(await color('.ao-button', 'background-color'))!;
    const label = parseColor(await color('.ao-button'))!;
    expect(contrastRatio(fill, label)).toBeGreaterThanOrEqual(4.5);
    const expectedActive = await page.locator('.authowl-root').evaluate(el => (el as HTMLElement).style.getPropertyValue('--ao-light-brand-active'));
    await page.locator('.ao-button').hover(); await page.mouse.down();
    expect(parseColor(await color('.ao-button', 'background-color'))).toBe(expectedActive);
    await page.mouse.up();
  })();
});
