'use client';
import type { CaptchaAdapter, CaptchaApi } from './captcha-providers';

const SCRIPT_LOAD_TIMEOUT_MS = 10_000;
const GLOBAL_POLL_INTERVAL_MS = 25;

const loaders = new Map<string, Promise<CaptchaApi>>();

function providerGlobal(adapter: CaptchaAdapter): CaptchaApi | undefined {
  return (window as unknown as Record<string, CaptchaApi | undefined>)[adapter.globalName];
}

/** Load one provider script once, with a retryable cache scoped to its URL. */
export function loadCaptcha(adapter: CaptchaAdapter): Promise<CaptchaApi> {
  const available = providerGlobal(adapter);
  if (available) return Promise.resolve(available);

  const cached = loaders.get(adapter.scriptUrl);
  if (cached) return cached;

  const loading = new Promise<CaptchaApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${adapter.scriptUrl}"]`,
    );
    const script = existing ?? document.createElement('script');
    let poll: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      if (poll !== undefined) clearInterval(poll);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const resolveWhenPublished = () => {
      const api = providerGlobal(adapter);
      if (!api) return false;
      cleanup();
      resolve(api);
      return true;
    };
    const loaded = () => {
      if (!resolveWhenPublished() && poll === undefined) {
        poll = setInterval(resolveWhenPublished, GLOBAL_POLL_INTERVAL_MS);
      }
    };
    const failed = () => {
      cleanup();
      if (!existing) script.remove();
      reject(new Error(`${adapter.label} failed to load`));
    };
    const timeout = setTimeout(failed, SCRIPT_LOAD_TIMEOUT_MS);

    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (existing) {
      // An existing script may have loaded before we attached the listener.
      loaded();
    } else {
      script.src = adapter.scriptUrl;
      script.async = true;
      script.defer = true;
      const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
      if (nonce) script.nonce = nonce;
      document.head.appendChild(script);
    }
  });

  const retryable = loading.catch((error: unknown) => {
    loaders.delete(adapter.scriptUrl);
    throw error;
  });
  loaders.set(adapter.scriptUrl, retryable);
  return retryable;
}
