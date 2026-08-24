'use client';
import * as React from 'react';
import type { CaptchaAdapter, CaptchaApi, CaptchaWidgetId } from './captcha-providers';

export const LOCAL_TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export type TurnstileApi = CaptchaApi;

export async function loadTurnstile(): Promise<{
  api: CaptchaApi;
  adapter: CaptchaAdapter;
}> {
  const [{ loadCaptcha }, { CAPTCHA_ADAPTERS }] = await Promise.all([
    import('./captcha-loader'),
    import('./captcha-providers'),
  ]);
  const adapter = CAPTCHA_ADAPTERS.turnstile;
  return { api: await loadCaptcha(adapter), adapter };
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
    let widget: { api: CaptchaApi; adapter: CaptchaAdapter; id: CaptchaWidgetId } | null = null;
    void loadTurnstile()
      .then(({ api, adapter }) => {
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
        widget = { api, adapter, id };
      })
      .catch(() => {
        if (active) callbacks.current.onUnavailable();
      });

    return () => {
      active = false;
      if (widget) widget.adapter.teardown(widget.api, widget.id);
    };
  }, [siteKey, theme]);

  if (!siteKey) return null;
  return <div className="ba-turnstile" ref={container} data-testid="phoneotp-turnstile" />;
}
