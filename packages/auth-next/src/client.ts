'use client';

import {
  resolveConfig,
  SESSION_TOKEN_HEADER,
  sessionChallengeIsEphemeral,
} from '@authowl/core';
import {
  APP_SESSION_BRIDGE_CODE_MAX_LENGTH,
  APP_SESSION_BRIDGE_HEADER,
} from './bridge-contract';

export class AuthOwlNextSessionBridgeError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuthOwlNextSessionBridgeError';
    this.status = status;
  }
}

export type AuthOwlNextFetchOptions = Readonly<{
  publishableKey: string;
  apiUrl: string;
  bridgePath?: string;
  fetch?: typeof fetch;
}>;

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url);
    return new URL(String(input));
  } catch {
    return null;
  }
}

function sameOriginBridgePath(value: string): string {
  const base = new URL('https://authowl.invalid');
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    throw new TypeError('bridgePath must be a same-origin absolute path');
  }
  if (
    !value.startsWith('/') ||
    parsed.origin !== base.origin ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError('bridgePath must be a same-origin absolute path');
  }
  return `${parsed.pathname}${parsed.search}`;
}

function rememberIntent(init: RequestInit | undefined): boolean | undefined {
  if (typeof init?.body !== 'string') return undefined;
  try {
    const body = JSON.parse(init.body) as { rememberMe?: unknown };
    return typeof body.rememberMe === 'boolean' ? body.rememberMe : undefined;
  } catch {
    return undefined;
  }
}

function requestHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  if (init?.headers) return new Headers(init.headers);
  return input instanceof Request ? new Headers(input.headers) : new Headers();
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

const SESSION_ESTABLISHING_PATHS = new Set([
  'change-password',
  'email-otp/verify-email',
  'get-session',
  'passkey/verify-authentication',
  'phone-otp/verify',
  'session/exchange',
  'sign-in/email',
  'sign-in/email-otp',
  'sign-in/social',
  'sign-in/username',
  'sign-up/email',
  'two-factor/verify-backup-code',
  'two-factor/verify-otp',
  'two-factor/verify-totp',
]);

async function sessionWasEstablished(path: string, response: Response): Promise<boolean> {
  if (response.headers.has(SESSION_TOKEN_HEADER)) return true;

  const needsPayloadEvidence =
    path === 'get-session'
    || path === 'sign-in/email'
    || path === 'sign-in/social'
    || path === 'sign-in/username'
    || path === 'sign-up/email';
  if (!needsPayloadEvidence) return true;
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) return false;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return false;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  if (path === 'sign-up/email') return record.sessionCreated === true;
  if (path === 'get-session') return !!record.user && !!record.session;
  return !!record.user;
}

async function bridgeError(response: Response): Promise<string | null> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload?.error === 'string' ? payload.error : null;
  } catch {
    return null;
  }
}

/**
 * Wrap the fetch passed to AuthOwlProvider so a live browser session is handed
 * to the app origin without exposing its bearer token to application script.
 */
export function createAuthOwlNextFetch(options: AuthOwlNextFetchOptions): typeof fetch {
  const baseFetch = options.fetch ?? globalThis.fetch;
  // Known debt: this shadow core transport works only because sessionTokenStore
  // is a projectId-keyed module singleton (packages/auth-core/src/session-token.ts:924),
  // a relationship no type states. packages/auth-core/src/config.ts:34-44
  // explicitly warns against reaching below a constructed client, but we need
  // both `.fetch` and `.session.tokens.observe(...)` so a bound-bearer browser
  // can mint with a fresh proof. A sanctioned core API is the real fix and is
  // tracked as follow-up.
  const bridgeConfig = resolveConfig({ ...options, fetch: baseFetch });
  const apiOrigin = bridgeConfig.apiUrl;
  const authPath = `/api/projects/${bridgeConfig.decoded.projectId}/auth/`;
  const capabilityPath = `${authPath}session/cookie-capability`;
  const mintPath = `${authPath}session/bridge-code`;
  const mintUrl = `${apiOrigin}${mintPath}`;
  const bridgePath = sameOriginBridgePath(options.bridgePath ?? '/api/authowl/session');
  const storageKey = `authowl:next-session-bridge:${bridgeConfig.decoded.projectId}`;
  let synchronization = Promise.resolve();
  let memoryEnsured = false;
  let bridgeUnavailable = false;

  const isEnsured = (): boolean => {
    try {
      return globalThis.sessionStorage?.getItem(storageKey) === '1' || memoryEnsured;
    } catch {
      return memoryEnsured;
    }
  };

  const markEnsured = (): void => {
    memoryEnsured = true;
    try {
      globalThis.sessionStorage?.setItem(storageKey, '1');
    } catch {
      // Memory still gives this wrapper the once-per-session guarantee when
      // storage is disabled by privacy policy.
    }
  };

  const resetEnsured = (): void => {
    memoryEnsured = false;
    try {
      globalThis.sessionStorage?.removeItem(storageKey);
    } catch {
      // A denied storage write must not interfere with the auth request.
    }
  };

  const serialize = (work: () => Promise<void>): Promise<void> => {
    synchronization = synchronization
      .catch(() => undefined)
      .then(work)
      // Bridge projection is recovery machinery. Its failures must never turn
      // a successful AuthOwl request into a rejected fetch at the caller.
      .catch(() => undefined);
    return synchronization;
  };

  const postToBridge = (body: { token: null } | { code: string; remember: boolean }) =>
    baseFetch(bridgePath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [APP_SESSION_BRIDGE_HEADER]: '1',
      },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(body),
    });

  const clear = (): Promise<void> => serialize(async () => {
    await postToBridge({ token: null });
  });

  const ensure = (remember: boolean): Promise<void> => serialize(async () => {
    // Re-check inside the serialized section: two session-bearing responses can
    // arrive together, and checking before the chain would mint two single-use
    // codes for the same session in one tab.
    if (bridgeUnavailable || isEnsured()) return;

    const minted = await bridgeConfig.fetch(mintUrl, {
      method: 'POST',
      headers: { 'x-publishable-key': bridgeConfig.publishableKey },
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    });
    if (minted.status === 404) {
      // Engine-first rollout: an older engine has no handoff route. Remember
      // that only for this wrapper so ordinary reads do not hammer a known 404.
      bridgeUnavailable = true;
      return;
    }
    if (!minted.ok) return;

    const payload = await minted.json() as { code?: unknown };
    if (
      typeof payload.code !== 'string'
      || payload.code.length > APP_SESSION_BRIDGE_CODE_MAX_LENGTH
    ) {
      return;
    }

    const bridged = await postToBridge({ code: payload.code, remember });
    if (bridged.ok) {
      markEnsured();
      return;
    }
    // A rejected deployment credential cannot repair itself within this page,
    // and retrying would mint and spend a new rate-limited code on every session
    // read. Auth-service outages remain retryable because they are transient.
    if (await bridgeError(bridged) === 'bridge_misconfigured') {
      bridgeUnavailable = true;
    }
  });

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init);
    const url = requestUrl(input);
    if (!url || url.origin !== apiOrigin || !url.pathname.startsWith(authPath)) {
      return response;
    }

    // Known debt: these URL matches infer core's beginSession/endSession
    // lifecycle from undocumented requests. Only bridge-seam.test.ts holds the
    // coupling today; a renamed or folded capability probe would otherwise
    // leave the bridge marked complete across a new session. Sanctioned core
    // beginSession/endSession events are the real fix.
    if (url.pathname === capabilityPath) {
      if (requestMethod(input, init) === 'POST') resetEnsured();
      return response;
    }

    if (response.ok && url.pathname === `${authPath}sign-out`) {
      resetEnsured();
      await clear();
      return response;
    }

    if (!response.ok || url.pathname === mintPath) return response;
    if (bridgeUnavailable || isEnsured()) return response;

    const relativePath = url.pathname.slice(authPath.length);
    // This is intentionally an allowlist, mirrored from core's session-bearing
    // response families. The old "any 200 JSON except known negatives" model
    // made signed-out password-reset, verification-email, and magic-link calls
    // burn the pre-auth bridge-mint rate bucket. New session doors must opt in.
    if (!SESSION_ESTABLISHING_PATHS.has(relativePath)) return response;

    try {
      const observed = response.clone();
      // The provider's outer core transport observes this header after this
      // wrapper returns. Observing it on the shared store now lets the bridge
      // mint use a freshly proofed bound bearer without delaying that handoff.
      if (observed.headers.has(SESSION_TOKEN_HEADER)) {
        bridgeConfig.session.tokens.observe(observed.headers);
      }
      if (!await sessionWasEstablished(relativePath, observed)) return response;
      const remember = rememberIntent(init) ?? !sessionChallengeIsEphemeral(requestHeaders(input, init));
      await ensure(remember);
    } catch {
      // Cloning, storage, proof creation, minting, and the same-origin POST are
      // all bridge work and therefore cannot consume or reject the caller's
      // successful response.
    }
    return response;
  };
}
