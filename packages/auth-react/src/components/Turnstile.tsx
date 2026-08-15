'use client';
import * as React from 'react';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_LOAD_TIMEOUT_MS = 10_000;
export const LOCAL_TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: 'light' | 'dark' | 'auto';
      action?: string;
      execution?: 'render' | 'execute';
      appearance?: 'always' | 'execute' | 'interaction-only';
      size?: 'normal' | 'compact' | 'flexible';
      language?: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      'timeout-callback'?: () => void;
      'unsupported-callback'?: () => void;
    },
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;
  loader = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const loaded = () => {
      cleanup();
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error('Turnstile unavailable'));
      }
    };
    const failed = () => {
      cleanup();
      if (!existing) script.remove();
      reject(new Error('Turnstile failed to load'));
    };
    const timeout = setTimeout(failed, SCRIPT_LOAD_TIMEOUT_MS);
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
      if (nonce) script.nonce = nonce;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    loader = null;
    throw error;
  });
  return loader;
}

export function Turnstile({
  siteKey,
  theme,
  onToken,
  onUnavailable,
}: {
  siteKey: string | null;
  theme: 'light' | 'dark' | 'system';
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const callbacks = React.useRef({ onToken, onUnavailable });
  callbacks.current = { onToken, onUnavailable };

  React.useEffect(() => {
    callbacks.current.onToken(null);
    if (!siteKey) {
      callbacks.current.onToken(LOCAL_TURNSTILE_TEST_TOKEN);
      return;
    }

    let active = true;
    let widget: { api: TurnstileApi; id: string } | null = null;
    void loadTurnstile()
      .then((api) => {
        if (!active || !container.current) return;
        const id = api.render(container.current, {
          sitekey: siteKey,
          theme: theme === 'system' ? 'auto' : theme,
          size: 'flexible',
          callback: (token) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => {
            callbacks.current.onToken(null);
            callbacks.current.onUnavailable();
          },
        });
        widget = { api, id };
      })
      .catch(() => {
        if (active) callbacks.current.onUnavailable();
      });

    return () => {
      active = false;
      if (widget) widget.api.remove(widget.id);
    };
  }, [siteKey, theme]);

  if (!siteKey) return null;
  return <div className="ba-turnstile" ref={container} data-testid="phoneotp-turnstile" />;
}
