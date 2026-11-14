// Test-only helpers and fixtures, not exported from the package.
import type {
  AuthOwlClient,
  ProjectJsonRequest,
  ProjectJsonResult,
  SessionState,
} from '@authowl/core';
import { vi } from 'vitest';
import type { BillingSnapshot } from './index';

export type WireReply = Readonly<{
  status: number;
  body?: unknown;
  retryAfterSeconds?: number | null;
  code?: string | null;
  requestId?: string | null;
}>;

export const USER_ID = '00000000-0000-4000-8000-000000000002';
export const ORG_ID = '00000000-0000-4000-8000-000000000003';
export const NOW = new Date('2026-11-13T10:00:00.000Z').getTime();
export const ALLOWED_LIST = {
  status: 'ok',
  subject: { type: 'user', id: USER_ID },
  source: 'snapshot',
  fetchedAt: '2026-11-13T10:00:00.000Z',
  entitlements: [
    { feature: 'reports', kind: 'boolean', allowed: true, balance: null },
  ],
};
export const BASELINE: BillingSnapshot = {
  status: 'ready',
  stale: false,
  reason: 'ok',
  entitlements: ALLOWED_LIST.entitlements,
  receivedAt: NOW,
  error: null,
};

export function makeCore(options: Readonly<{
  state?: SessionState;
  replies?: WireReply[];
  handler?: (path: string, request: ProjectJsonRequest<unknown>) => Promise<WireReply>;
}> = {}) {
  let state = options.state ?? sessionState(USER_ID, null);
  const sessionListeners = new Set<() => void>();
  const sessionSubscribe = vi.fn((listener: () => void) => {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  });
  const replies = [...(options.replies ?? [ok(ALLOWED_LIST)])];
  const request = vi.fn(async <T>(
    path: string,
    input: ProjectJsonRequest<T>,
  ): Promise<ProjectJsonResult<T>> => {
    const reply = options.handler
      ? await options.handler(path, input as ProjectJsonRequest<unknown>)
      : replies.shift() ?? ok(ALLOWED_LIST);
    if (reply.status >= 200 && reply.status < 300) {
      return { ok: true, data: input.decode(reply.body) };
    }
    return {
      ok: false,
      status: reply.status,
      code: reply.code ?? null,
      requestId: reply.requestId ?? null,
      retryAfterSeconds: reply.retryAfterSeconds ?? null,
    };
  });
  const core = {
    sessionStore: {
      subscribe: sessionSubscribe,
      getSnapshot: () => state,
      refresh: async () => {},
    },
    [Symbol.for('authowl.core.client-extension.v1')]: {
      version: 1,
      requestProjectJson: request,
    },
  } as unknown as AuthOwlClient;
  return {
    core,
    request,
    sessionSubscribe,
    setSession(
      userId: string | null,
      organizationId: string | null,
      stateOptions: Readonly<{ pending?: boolean; error?: boolean; pendingMfa?: boolean }> = {},
    ) {
      state = sessionState(userId, organizationId, stateOptions);
      for (const listener of sessionListeners) listener();
    },
  };
}

export function sessionState(
  userId: string | null,
  organizationId: string | null,
  options: Readonly<{ pending?: boolean; error?: boolean; pendingMfa?: boolean }> = {},
): SessionState {
  return {
    data: userId === null ? null : {
      user: { id: userId },
      session: {
        activeOrganizationId: organizationId,
        pendingMfaEnrollment: options.pendingMfa === true,
      },
    },
    isPending: options.pending === true,
    isRefetching: false,
    error: options.error ? { code: 'SESSION_READ_FAILED' } : null,
    refetch: vi.fn(),
  } as unknown as SessionState;
}

export function ok(body: unknown): WireReply {
  return { status: 200, body };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

export function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}
