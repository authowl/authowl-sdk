const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const SCRIPT_TIMEOUT_MS = 15_000;

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

type GooglePromptMomentNotification = {
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
};

type GoogleIdApi = {
  initialize: (options: Record<string, unknown>) => void;
  prompt: (listener?: (notification: GooglePromptMomentNotification) => void) => void;
  cancel: () => void;
};

type GoogleWindow = Window & {
  google?: { accounts?: { id?: GoogleIdApi } };
};

export type GoogleOneTapRuntimeErrorCode =
  | 'script_load_failed'
  | 'api_unavailable'
  | 'configuration_conflict'
  | 'duplicate_instance'
  | 'prompt_failed';

export class GoogleOneTapRuntimeError extends Error {
  constructor(readonly code: GoogleOneTapRuntimeErrorCode) {
    super(code);
    this.name = 'GoogleOneTapRuntimeError';
  }
}

export type GoogleOneTapRuntimeOptions = {
  clientId: string;
  nonce?: string;
  autoSelect: boolean;
  cancelOnTapOutside: boolean;
  context: 'signin' | 'signup' | 'use';
  itpSupport: boolean;
  loginHint?: string;
  hostedDomain?: string;
  stateCookieDomain?: string;
  scriptNonce?: string;
};

export type GoogleOneTapRuntimeCallbacks = {
  onCredential: (credential: GoogleCredentialResponse) => void;
  onSkipped: () => void;
  onDismissed: (reason: string) => void;
};

export type GoogleOneTapHandle = { cancel: () => void };

type Runtime = {
  api: GoogleIdApi;
  configurationKey: string;
  owner: symbol | null;
  callbacks: GoogleOneTapRuntimeCallbacks | null;
};

let scriptPromise: Promise<GoogleIdApi> | null = null;
let runtime: Runtime | null = null;

function currentApi(): GoogleIdApi | null {
  if (typeof window === 'undefined') return null;
  return (window as GoogleWindow).google?.accounts?.id ?? null;
}

function loadGoogleIdentity(scriptNonce?: string): Promise<GoogleIdApi> {
  const loaded = currentApi();
  if (loaded) return Promise.resolve(loaded);
  if (scriptPromise) return scriptPromise;
  if (typeof document === 'undefined') {
    return Promise.reject(new GoogleOneTapRuntimeError('api_unavailable'));
  }

  scriptPromise = new Promise<GoogleIdApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT}"]`,
    );
    const script = existing ?? document.createElement('script');
    let settled = false;
    const timer = globalThis.setTimeout(() => fail('script_load_failed'), SCRIPT_TIMEOUT_MS);

    function cleanup() {
      globalThis.clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    }
    function fail(code: GoogleOneTapRuntimeErrorCode) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new GoogleOneTapRuntimeError(code));
    }
    function onLoad() {
      const api = currentApi();
      if (!api) {
        fail('api_unavailable');
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      resolve(api);
    }
    function onError() {
      fail('script_load_failed');
    }

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.dataset.authowlGoogleIdentity = 'true';
      if (scriptNonce) script.nonce = scriptNonce;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

function configurationKey(options: GoogleOneTapRuntimeOptions): string {
  const { scriptNonce: _scriptNonce, ...identityOptions } = options;
  return JSON.stringify(identityOptions);
}

function initializeRuntime(api: GoogleIdApi, options: GoogleOneTapRuntimeOptions): Runtime {
  const next: Runtime = {
    api,
    configurationKey: configurationKey(options),
    owner: null,
    callbacks: null,
  };
  api.initialize({
    client_id: options.clientId,
    callback: (response: GoogleCredentialResponse) => runtime?.callbacks?.onCredential(response),
    auto_select: options.autoSelect,
    cancel_on_tap_outside: options.cancelOnTapOutside,
    context: options.context,
    itp_support: options.itpSupport,
    ...(options.nonce ? { nonce: options.nonce } : {}),
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
    ...(options.hostedDomain ? { hd: options.hostedDomain } : {}),
    ...(options.stateCookieDomain ? { state_cookie_domain: options.stateCookieDomain } : {}),
  });
  runtime = next;
  return next;
}

function dispatchMoment(
  owner: symbol,
  notification: GooglePromptMomentNotification,
): void {
  if (!runtime || runtime.owner !== owner || !runtime.callbacks) return;
  if (notification.isSkippedMoment?.()) {
    runtime.callbacks.onSkipped();
    return;
  }
  if (!notification.isDismissedMoment?.()) return;
  const reason = notification.getDismissedReason?.() ?? 'unknown';
  if (reason !== 'credential_returned') runtime.callbacks.onDismissed(reason);
}

/**
 * Acquire the page-wide Google Identity Services prompt. Google documents
 * initialize() as a once-per-page operation, so compatible remounts reuse the
 * initialized client while conflicting or duplicate live instances fail closed.
 */
export async function startGoogleOneTap(
  options: GoogleOneTapRuntimeOptions,
  callbacks: GoogleOneTapRuntimeCallbacks,
  signal?: AbortSignal,
): Promise<GoogleOneTapHandle | null> {
  const api = await loadGoogleIdentity(options.scriptNonce);
  if (signal?.aborted) return null;

  const key = configurationKey(options);
  const active = runtime ?? initializeRuntime(api, options);
  if (active.api !== api || active.configurationKey !== key) {
    throw new GoogleOneTapRuntimeError('configuration_conflict');
  }
  if (active.owner) throw new GoogleOneTapRuntimeError('duplicate_instance');

  const owner = Symbol('authowl-google-one-tap');
  active.owner = owner;
  active.callbacks = callbacks;
  try {
    api.prompt((notification) => dispatchMoment(owner, notification));
  } catch {
    active.owner = null;
    active.callbacks = null;
    throw new GoogleOneTapRuntimeError('prompt_failed');
  }

  return {
    cancel() {
      if (!runtime || runtime.owner !== owner) return;
      runtime.owner = null;
      runtime.callbacks = null;
      try {
        api.cancel();
      } catch {
        // Cancellation is best-effort during unmount; no consumer callback is safe here.
      }
    },
  };
}

/** Reset module-level browser state between jsdom tests. Not exported publicly. */
export function resetGoogleOneTapRuntimeForTests(): void {
  runtime = null;
  scriptPromise = null;
  document.querySelectorAll(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`).forEach((script) => script.remove());
}
