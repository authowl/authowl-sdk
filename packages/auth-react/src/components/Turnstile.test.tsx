// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

afterEach(() => {
  document.head.replaceChildren();
  Reflect.deleteProperty(window, 'turnstile');
  vi.resetModules();
});

describe('Turnstile loader', () => {
  it('copies the host CSP nonce onto the provider script', async () => {
    const trusted = document.createElement('script');
    trusted.nonce = 'response-nonce';
    document.head.appendChild(trusted);
    const api = { render: vi.fn(), execute: vi.fn(), remove: vi.fn() };
    const { loadTurnstile } = await import('./Turnstile');

    const loading = loadTurnstile();
    const provider = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)!;
    expect(provider.nonce).toBe('response-nonce');

    Object.defineProperty(window, 'turnstile', { configurable: true, value: api });
    provider.dispatchEvent(new Event('load'));
    await expect(loading).resolves.toBe(api);
  });

  it('removes a failed script so a later attempt can load a fresh copy', async () => {
    const { loadTurnstile } = await import('./Turnstile');

    const first = loadTurnstile();
    const failed = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)!;
    failed.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('Turnstile failed to load');
    expect(failed.isConnected).toBe(false);

    const second = loadTurnstile();
    const retry = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)!;
    expect(retry).not.toBe(failed);
    retry.dispatchEvent(new Event('error'));
    await expect(second).rejects.toThrow('Turnstile failed to load');
  });
});
