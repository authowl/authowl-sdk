'use client';

import {
  resolveAuthTarget,
  withSessionTransportIntegration,
  type SessionLifecycleEvent,
  type SessionTransportConnection,
  type SessionTransportIntegration,
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

function sameOriginBridgePath(value: string): string {
  const base = new URL('https://authowl.invalid');
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    throw new TypeError('bridgePath must be a same-origin absolute path');
  }
  if (
    !value.startsWith('/')
    || parsed.origin !== base.origin
    || parsed.hash
    || parsed.username
    || parsed.password
  ) {
    throw new TypeError('bridgePath must be a same-origin absolute path');
  }
  return `${parsed.pathname}${parsed.search}`;
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
 *
 * Core connects this adapter to the exact resolved session transport. The
 * bridge therefore uses the same cookie/bearer verdict and sender proof as the
 * client instead of constructing a shadow config or guessing lifecycle from
 * endpoint URLs.
 */
export function createAuthOwlNextFetch(options: AuthOwlNextFetchOptions): typeof fetch {
  const baseFetch = options.fetch ?? globalThis.fetch;
  const target = resolveAuthTarget(options);
  const mintUrl = `${target.projectBaseURL}/session/bridge-code`;
  const bridgePath = sameOriginBridgePath(options.bridgePath ?? '/api/authowl/session');
  const storageKey = `authowl:next-session-bridge:${target.decoded.projectId}`;
  let connection: SessionTransportConnection | null = null;
  let detachLifecycle: (() => void) | null = null;
  let detachSessionStore: (() => void) | null = null;
  let synchronization = Promise.resolve();
  let memoryEnsured = false;
  let currentSessionId: string | null = null;
  // Restore persistence only for the exact session that originally requested it.
  let remember = false;
  let sessionBeginning = false;
  const preferenceKey = `${storageKey}:session`;
  let bridgeUnavailable = false;
  let sessionEnding: Promise<void> | null = null;

  const storedEnsured = (): boolean => {
    try {
      return globalThis.sessionStorage?.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  };

  const hasEnsuredProjection = (): boolean => memoryEnsured || storedEnsured();

  const markEnsured = (): void => {
    memoryEnsured = true;
    try {
      globalThis.sessionStorage?.setItem(storageKey, '1');
    } catch {
      // Memory still deduplicates within this wrapper when storage is disabled.
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

  const storedPreference = (): { sessionId: string; remember: boolean } | null => {
    try {
      const value = JSON.parse(globalThis.localStorage?.getItem(preferenceKey) ?? 'null');
      return typeof value?.sessionId === 'string' && typeof value?.remember === 'boolean'
        ? value : null;
    } catch {
      return null;
    }
  };

  const savePreference = (): void => {
    if (!currentSessionId) return;
    try {
      globalThis.localStorage?.setItem(preferenceKey, JSON.stringify({
        sessionId: currentSessionId, remember,
      }));
    } catch {
      // Storage can be disabled. The current client still retains the choice.
    }
  };

  const clearPreference = (): void => {
    try {
      globalThis.localStorage?.removeItem(preferenceKey);
    } catch {
      // Storage failure must not interrupt session cleanup.
    }
  };

  const selectSession = (sessionId: string): void => {
    if (currentSessionId === sessionId) return;
    const stored = storedPreference();
    if (currentSessionId !== null || (stored && stored.sessionId !== sessionId)) {
      resetEnsured();
    }
    if (!sessionBeginning) remember = stored?.sessionId === sessionId && stored.remember;
    currentSessionId = sessionId;
    sessionBeginning = false;
  };

  const serialize = (work: () => Promise<void>): Promise<void> => {
    synchronization = synchronization
      .catch(() => undefined)
      .then(work)
      // Bridge projection is recovery machinery. Its failures must never turn
      // a successful AuthOwl request into a rejected action at the caller.
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

  const beginClear = (): Promise<void> => {
    if (sessionEnding) return sessionEnding;
    const task = clear().finally(() => {
      if (sessionEnding === task) sessionEnding = null;
    });
    sessionEnding = task;
    return task;
  };

  const ensure = (): Promise<void> =>
    serialize(async () => {
      // Re-check inside the serialized section: initial hydration and a
      // mutation refresh can announce the same session concurrently.
      if (bridgeUnavailable || hasEnsuredProjection()) return;
      const authenticatedFetch = connection?.authenticatedFetch;
      if (!authenticatedFetch) return;

      // Sign-in actions project before the core store refreshes. Read through
      // the ungated transport here: awaiting the store would deadlock a handoff
      // whose first session read is waiting for this projection.
      if (currentSessionId === null) {
        const sessionResponse = await authenticatedFetch(`${target.projectBaseURL}/get-session`, {
          headers: { 'x-publishable-key': target.publishableKey },
          credentials: 'include', cache: 'no-store', redirect: 'error',
        });
        if (!sessionResponse.ok) return;
        const data = await sessionResponse.json() as { session?: { id?: unknown } } | null;
        if (typeof data?.session?.id !== 'string') return;
        selectSession(data.session.id);
      }
      const remembered = remember;
      const minted = await authenticatedFetch(mintUrl, {
        method: 'POST',
        headers: { 'x-publishable-key': target.publishableKey },
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
      });
      if (minted.status === 404) {
        // Server-first rollout compatibility. Do not hammer an older engine on
        // every session-store notification in this page.
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

      const bridged = await postToBridge({ code: payload.code, remember: remembered });
      if (bridged.ok) {
        markEnsured();
        savePreference();
        return;
      }
      // A rejected deployment credential cannot repair itself within this page.
      // Auth-service outages remain retryable because they are transient.
      if (await bridgeError(bridged) === 'bridge_misconfigured') {
        bridgeUnavailable = true;
      }
    });

  const onLifecycle = (event: SessionLifecycleEvent): void => {
    if (event.type === 'beginSession') {
      remember = event.remember;
      sessionBeginning = true;
      currentSessionId = null;
      resetEnsured();
      return;
    }
    currentSessionId = null;
    sessionBeginning = false;
    remember = false;
    clearPreference();
    resetEnsured();
    void beginClear();
  };

  const synchronizeSession = (): void => {
    const snapshot = connection?.sessionStore.getSnapshot();
    // A failed read cannot establish whether the session ended. Preserve the
    // projection until a successful read or an explicit session-ending event.
    if (!snapshot || snapshot.isPending || snapshot.isRefetching || snapshot.error) return;
    const sessionId = snapshot.data?.session.id ?? null;
    if (!sessionId) {
      const projected = currentSessionId !== null || hasEnsuredProjection();
      currentSessionId = null;
      if (!sessionBeginning) {
        remember = false;
        clearPreference();
      }
      if (projected) {
        resetEnsured();
        void clear();
      }
      return;
    }
    selectSession(sessionId);
    void ensure();
  };

  const integration: SessionTransportIntegration = {
    connect(next) {
      detachLifecycle?.();
      detachSessionStore?.();
      connection = next;
      detachLifecycle = next.subscribeLifecycle(onLifecycle);
      detachSessionStore = next.sessionStore.subscribe(synchronizeSession);
      synchronizeSession();
    },
    sessionEstablished() {
      return ensure();
    },
    sessionEnded() {
      return beginClear();
    },
  };

  // Do not annotate global fetch itself: several AuthOwl projects may coexist
  // in one page. The marker belongs only to this project-specific passthrough.
  const passthrough = ((input: RequestInfo | URL, init?: RequestInit) =>
    baseFetch(input, init)) as typeof fetch;
  return withSessionTransportIntegration(passthrough, integration);
}
