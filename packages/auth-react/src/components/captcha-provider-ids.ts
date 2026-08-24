export const CAPTCHA_PROVIDER_IDS = ['turnstile', 'hcaptcha', 'recaptcha-v2'] as const;

export type CaptchaProviderId = (typeof CAPTCHA_PROVIDER_IDS)[number];

export function isSupportedCaptchaProvider(provider: string): provider is CaptchaProviderId {
  return (CAPTCHA_PROVIDER_IDS as readonly string[]).includes(provider);
}
