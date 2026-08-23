// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

afterEach(() => {
  document.head.replaceChildren();
  Reflect.deleteProperty(window, 'turnstile');
  Reflect.deleteProperty(window, 'hcaptcha');
  vi.resetModules();
});

describe('captcha loader', () => {
  it('copies the host CSP nonce onto the provider script', async () => {
    const trusted = document.createElement('script');
    trusted.nonce = 'response-nonce';
    document.head.appendChild(trusted);
    const api = { render: vi.fn(), execute: vi.fn(), remove: vi.fn() };
    const { loadCaptcha } = await import('./captcha-loader');
    const { CAPTCHA_ADAPTERS } = await import('./captcha-providers');

    const loading = loadCaptcha(CAPTCHA_ADAPTERS.turnstile);
    const provider = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)!;
    expect(provider.nonce).toBe('response-nonce');

    Object.defineProperty(window, 'turnstile', { configurable: true, value: api });
    provider.dispatchEvent(new Event('load'));
    await expect(loading).resolves.toBe(api);
  });

  it('removes a failed script so a later attempt can load a fresh copy', async () => {
    const { loadCaptcha } = await import('./captcha-loader');
    const { CAPTCHA_ADAPTERS } = await import('./captcha-providers');

    const first = loadCaptcha(CAPTCHA_ADAPTERS.turnstile);
    const failed = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)!;
    failed.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('Turnstile failed to load');
    expect(failed.isConnected).toBe(false);

    const second = loadCaptcha(CAPTCHA_ADAPTERS.turnstile);
    const retry = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)!;
    expect(retry).not.toBe(failed);
    retry.dispatchEvent(new Event('error'));
    await expect(second).rejects.toThrow('Turnstile failed to load');
  });

  it('waits briefly for a provider global published after the load event', async () => {
    const { loadCaptcha } = await import('./captcha-loader');
    const { CAPTCHA_ADAPTERS } = await import('./captcha-providers');
    const loading = loadCaptcha(CAPTCHA_ADAPTERS.hcaptcha);
    const provider = document.querySelector<HTMLScriptElement>(
      `script[src="${CAPTCHA_ADAPTERS.hcaptcha.scriptUrl}"]`,
    )!;
    const api = { render: vi.fn(), execute: vi.fn(), remove: vi.fn() };

    provider.dispatchEvent(new Event('load'));
    Object.defineProperty(window, 'hcaptcha', { configurable: true, value: api });

    await expect(loading).resolves.toBe(api);
  });
});
