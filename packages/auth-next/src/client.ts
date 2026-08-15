'use client';

import {
  resolveAuthTarget,
  SESSION_TOKEN_HEADER,
  sessionChallengeIsEphemeral,
} from '@authowl/core';
import { APP_SESSION_BRIDGE_HEADER } from './bridge-contract';

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

/**
 * Wrap the fetch passed to AuthOwlProvider so every issued browser session is
 * validated and projected onto the Next.js origin before a drop-in redirects.
 */
export function createAuthOwlNextFetch(options: AuthOwlNextFetchOptions): typeof fetch {
  const target = resolveAuthTarget(options);
  const apiOrigin = target.apiUrl;
  const authPath = `/api/projects/${target.decoded.projectId}/auth/`;
  const bridgePath = sameOriginBridgePath(options.bridgePath ?? '/api/authowl/session');
  const baseFetch = options.fetch ?? globalThis.fetch;
  let synchronization = Promise.resolve();

  const sync = (token: string | null, remember: boolean): Promise<void> => {
    synchronization = synchronization
      .catch(() => undefined)
      .then(async () => {
        const response = await baseFetch(bridgePath, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [APP_SESSION_BRIDGE_HEADER]: '1',
          },
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          body: JSON.stringify({ token, remember }),
        });
        if (!response.ok) {
          throw new AuthOwlNextSessionBridgeError(
            `AuthOwl Next.js session projection failed with status ${response.status}.`,
            response.status,
          );
        }
      });
    return synchronization;
  };

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init);
    const url = requestUrl(input);
    if (!url || url.origin !== apiOrigin || !url.pathname.startsWith(authPath)) {
      return response;
    }

    const token = response.headers.get(SESSION_TOKEN_HEADER);
    if (token) {
      const remember = rememberIntent(init) ?? !sessionChallengeIsEphemeral(requestHeaders(input, init));
      await sync(token, remember);
    }
    else if (response.ok && url.pathname === `${authPath}sign-out`) {
      await sync(null, true);
    }
    return response;
  };
}
