'use client';

/**
 * The bot-challenge providers this build of the SDK can render.
 *
 * Turnstile, hCaptcha and reCAPTCHA v2 all expose the same explicit-render
 * shape - a script that publishes a global, then `render(container, {sitekey,
 * callback, ...})` returning a widget id. This registry captures their script
 * globals plus the provider-specific on-demand options and teardown behavior.
 *
 * A provider ABSENT from this registry is not an error in the configuration; it
 * means the project has been switched to something newer than this build. The
 * caller is expected to say so rather than render nothing, because a challenge
 * that renders nothing sends no token and the user meets an unexplained refusal.
 */
export type CaptchaProviderId = 'turnstile' | 'hcaptcha' | 'recaptcha-v2';

export type CaptchaWidgetId = string | number;

export type CaptchaTheme = 'light' | 'dark' | 'auto';

export type CaptchaRenderOptions = {
  sitekey: string;
  theme: CaptchaTheme;
  size?: 'normal' | 'compact' | 'flexible' | 'invisible';
  action?: string;
  language?: string;
  execution?: 'render' | 'execute';
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  'timeout-callback'?: () => void;
  'unsupported-callback'?: () => void;
};

export type CaptchaApi = {
  render(container: HTMLElement, options: CaptchaRenderOptions): CaptchaWidgetId;
  execute(widgetId: CaptchaWidgetId): void;
  remove?(widgetId: CaptchaWidgetId): void;
  reset?(widgetId: CaptchaWidgetId): void;
};

type InvisibleRenderInput = {
  siteKey: string;
  theme: CaptchaTheme;
  action: string;
  language: string | undefined;
};

export type CaptchaAdapter = {
  /** Script that publishes the global. Explicit render, so nothing auto-mounts. */
  scriptUrl: string;
  /** Property on `window` the script publishes. */
  globalName: string;
  /** Shown when a challenge cannot be completed here. */
  label: string;
  /** Provider-specific options for an on-demand widget. */
  invisibleRenderOptions(input: InvisibleRenderInput): CaptchaRenderOptions;
  /** Dispose of a widget without leaking provider exceptions to React. */
  teardown(api: CaptchaApi, widgetId: CaptchaWidgetId): void;
};

/** Resolve Turnstile's 'auto' for providers that only understand light|dark. */
function preferredTheme(): 'light' | 'dark' {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function teardown(api: CaptchaApi, widgetId: CaptchaWidgetId): void {
  if (api.remove) {
    try {
      api.remove(widgetId);
      return;
    } catch {
      // Some provider-shaped globals throw for unsupported methods. Try reset.
    }
  }
  try {
    api.reset?.(widgetId);
  } catch {
    // Teardown is best-effort and must never escape into the consuming app.
  }
}

export const CAPTCHA_ADAPTERS: Record<CaptchaProviderId, CaptchaAdapter> = {
  turnstile: {
    scriptUrl: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    globalName: 'turnstile',
    label: 'Cloudflare Turnstile',
    invisibleRenderOptions: ({ siteKey, theme, action, language }) => ({
      sitekey: siteKey,
      theme,
      action,
      language,
      execution: 'execute',
      appearance: 'interaction-only',
      size: 'flexible',
    }),
    teardown,
  },
  hcaptcha: {
    scriptUrl: 'https://js.hcaptcha.com/1/api.js?render=explicit',
    globalName: 'hcaptcha',
    label: 'hCaptcha',
    invisibleRenderOptions: ({ siteKey, theme }) => ({
      sitekey: siteKey,
      // 'auto' is Turnstile vocabulary. hCaptcha and reCAPTCHA take light|dark
      // only and silently fall back to light on anything else, which reads badly
      // in a dark application.
      theme: theme === 'auto' ? preferredTheme() : theme,
      size: 'invisible',
    }),
    teardown,
  },
  'recaptcha-v2': {
    scriptUrl: 'https://www.google.com/recaptcha/api.js?render=explicit',
    globalName: 'grecaptcha',
    label: 'reCAPTCHA',
    invisibleRenderOptions: ({ siteKey, theme }) => ({
      sitekey: siteKey,
      // 'auto' is Turnstile vocabulary. hCaptcha and reCAPTCHA take light|dark
      // only and silently fall back to light on anything else, which reads badly
      // in a dark application.
      theme: theme === 'auto' ? preferredTheme() : theme,
      size: 'invisible',
    }),
    teardown,
  },
};

export function captchaAdapterFor(provider: string): CaptchaAdapter | null {
  return CAPTCHA_ADAPTERS[provider as CaptchaProviderId] ?? null;
}
