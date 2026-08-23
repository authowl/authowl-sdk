'use client';

/**
 * The bot-challenge providers this build of the SDK can render.
 *
 * Turnstile, hCaptcha and reCAPTCHA v2 all expose the same explicit-render
 * shape - a script that publishes a global, then `render(container, {sitekey,
 * callback, ...})` returning a widget id - so they differ only in the script URL
 * and the name of the global. That is what this registry holds.
 *
 * A provider ABSENT from this registry is not an error in the configuration; it
 * means the project has been switched to something newer than this build. The
 * caller is expected to say so rather than render nothing, because a challenge
 * that renders nothing sends no token and the user meets an unexplained refusal.
 */
export type CaptchaProviderId = 'turnstile' | 'hcaptcha' | 'recaptcha-v2';

export type CaptchaAdapter = {
  /** Script that publishes the global. Explicit render, so nothing auto-mounts. */
  scriptUrl: string;
  /** Property on `window` the script publishes. */
  globalName: string;
  /** Shown when a challenge cannot be completed here. */
  label: string;
};

export const CAPTCHA_ADAPTERS: Record<CaptchaProviderId, CaptchaAdapter> = {
  turnstile: {
    scriptUrl: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    globalName: 'turnstile',
    label: 'Cloudflare Turnstile',
  },
  hcaptcha: {
    scriptUrl: 'https://js.hcaptcha.com/1/api.js?render=explicit',
    globalName: 'hcaptcha',
    label: 'hCaptcha',
  },
  'recaptcha-v2': {
    scriptUrl: 'https://www.google.com/recaptcha/api.js?render=explicit',
    globalName: 'grecaptcha',
    label: 'reCAPTCHA',
  },
};

export function captchaAdapterFor(provider: string): CaptchaAdapter | null {
  return CAPTCHA_ADAPTERS[provider as CaptchaProviderId] ?? null;
}
