'use client';
import * as React from 'react';
import { loadCaptcha } from './captcha-loader';
import {
  CAPTCHA_ADAPTERS,
  type CaptchaApi,
  type CaptchaWidgetId,
} from './captcha-providers';

export const LOCAL_TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export type TurnstileApi = CaptchaApi;

export function loadTurnstile(): Promise<CaptchaApi> {
  return loadCaptcha(CAPTCHA_ADAPTERS.turnstile);
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
    const adapter = CAPTCHA_ADAPTERS.turnstile;
    let widget: { api: CaptchaApi; id: CaptchaWidgetId } | null = null;
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
      if (widget) adapter.teardown(widget.api, widget.id);
    };
  }, [siteKey, theme]);

  if (!siteKey) return null;
  return <div className="ba-turnstile" ref={container} data-testid="phoneotp-turnstile" />;
}
