import { describe, expect, it } from 'vitest';

import { createAuthOwlNative } from './client';
import { createCookieJarFetch, readSetCookie, sessionStorageKey } from './cookie-jar';
import { MemoryStorage } from './storage';

const PROJECT_ID = '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60';
const PUBLISHABLE_KEY = `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`;
const SECURE_COOKIE = `__Secure-p_${PROJECT_ID.replace(/-/g, '')}.session_token`;
const PLAIN_COOKIE = `p_${PROJECT_ID.replace(/-/g, '')}.session_token`;

/** Records what the wrapped fetch was called with, and replies as told. */
function recordingFetch(response: () => Response) {
  const calls: RequestInit[] = [];
  const impl = (async (_input: unknown, init?: RequestInit) => {
    calls.push(init ?? {});
    return response();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function jarWith(storage = new MemoryStorage(), secure = true) {
  const { impl, calls } = recordingFetch(
    () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
  );
  const jar = createCookieJarFetch({ storage, projectId: PROJECT_ID, secure, fetchImpl: impl });
  return { jar, calls, storage };
}

function cookieHeaderOf(init: RequestInit): string | null {
  return new Headers(init.headers).get('cookie');
}

describe('readSetCookie', () => {
  it('reads the named cookie and drops its attributes', () => {
    const header = `${SECURE_COOKIE}=abc123; Path=/; HttpOnly; SameSite=Lax; Secure`;
    expect(readSetCookie(header, SECURE_COOKIE)).toBe('abc123');
  });

  it('ignores a cookie with a different name', () => {
    expect(readSetCookie('other=abc123; Path=/', SECURE_COOKIE)).toBeNull();
  });

  it('finds the cookie among several newline-joined entries', () => {
    const header = [
      'csrf=zzz; Path=/',
      `${SECURE_COOKIE}=abc123; Path=/; HttpOnly`,
    ].join('\n');
    expect(readSetCookie(header, SECURE_COOKIE)).toBe('abc123');
  });

  it('is not fooled by an Expires attribute containing a comma', () => {
    const header = `${SECURE_COOKIE}=abc123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/`;
    expect(readSetCookie(header, SECURE_COOKIE)).toBe('abc123');
  });

  it('reports a cleared cookie as an empty value, not as absent', () => {
    expect(readSetCookie(`${SECURE_COOKIE}=; Max-Age=0`, SECURE_COOKIE)).toBe('');
  });

  it('returns null when no cookie was set at all', () => {
    expect(readSetCookie(null, SECURE_COOKIE)).toBeNull();
  });

  it('finds the session cookie among separated Set-Cookie values', () => {
    // `getSetCookie()` keeps repeated headers intact. Comma-joining them first
    // is lossy, because the csrf value below legitimately contains commas.
    expect(readSetCookie([
      'csrf=zzz; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
      `${SECURE_COOKIE}=abc123; Path=/; HttpOnly`,
    ], SECURE_COOKIE)).toBe('abc123');
  });
});

describe('createCookieJarFetch with separated Set-Cookie values', () => {
  it('captures the session cookie when the runtime exposes getSetCookie', async () => {
    const storage = new MemoryStorage();
    const response = new Response('{}');
    // Model a runtime whose Headers implements the modern accessor, with the
    // session cookie behind an unrelated one.
    Object.defineProperty(response.headers, 'getSetCookie', {
      value: () => [
        'csrf=zzz; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
        `${SECURE_COOKIE}=tok_multi; Path=/; HttpOnly`,
      ],
    });
    const jar = createCookieJarFetch({
      storage,
      projectId: PROJECT_ID,
      secure: true,
      fetchImpl: (async () => response) as unknown as typeof fetch,
    });

    await jar('https://api.authowl.dev/sign-in');
    expect(await storage.getItem(sessionStorageKey(PROJECT_ID))).toBe('tok_multi');
  });
});

describe('createCookieJarFetch', () => {
  it('sends no cookie when nothing has been stored yet', async () => {
    const { jar, calls } = jarWith();
    await jar('https://api.authowl.dev/x');
    expect(cookieHeaderOf(calls[0]!)).toBeNull();
  });

  it('captures the session cookie the server sets', async () => {
    const storage = new MemoryStorage();
    const { impl } = recordingFetch(
      () => new Response('{}', {
        headers: { 'set-cookie': `${SECURE_COOKIE}=tok_1; Path=/; HttpOnly` },
      }),
    );
    const jar = createCookieJarFetch({
      storage, projectId: PROJECT_ID, secure: true, fetchImpl: impl,
    });

    await jar('https://api.authowl.dev/sign-in');
    expect(await storage.getItem(sessionStorageKey(PROJECT_ID))).toBe('tok_1');
  });

  it('replays a stored cookie on the next request', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(sessionStorageKey(PROJECT_ID), 'tok_1');
    const { jar, calls } = jarWith(storage);

    await jar('https://api.authowl.dev/get-session');
    expect(cookieHeaderOf(calls[0]!)).toBe(`${SECURE_COOKIE}=tok_1`);
  });

  it('honors credentials omit for public project configuration', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(sessionStorageKey(PROJECT_ID), 'tok_1');
    const { jar, calls } = jarWith(storage);

    await jar('https://api.authowl.dev/public-config', { credentials: 'omit' });

    expect(cookieHeaderOf(calls[0]!)).toBeNull();
  });

  it('preserves headers the caller already set', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(sessionStorageKey(PROJECT_ID), 'tok_1');
    const { jar, calls } = jarWith(storage);

    await jar('https://api.authowl.dev/x', {
      headers: { 'x-publishable-key': PUBLISHABLE_KEY },
    });
    const headers = new Headers(calls[0]!.headers);
    expect(headers.get('x-publishable-key')).toBe(PUBLISHABLE_KEY);
    expect(headers.get('cookie')).toBe(`${SECURE_COOKIE}=tok_1`);
  });

  it('appends to a cookie header the caller already set', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(sessionStorageKey(PROJECT_ID), 'tok_1');
    const { jar, calls } = jarWith(storage);

    await jar('https://api.authowl.dev/x', { headers: { cookie: 'consent=1' } });
    expect(cookieHeaderOf(calls[0]!)).toBe(`consent=1; ${SECURE_COOKIE}=tok_1`);
  });

  it('forgets the session when the server clears the cookie', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(sessionStorageKey(PROJECT_ID), 'tok_1');
    const { impl } = recordingFetch(
      () => new Response('{}', {
        headers: { 'set-cookie': `${SECURE_COOKIE}=; Max-Age=0; Path=/` },
      }),
    );
    const jar = createCookieJarFetch({
      storage, projectId: PROJECT_ID, secure: true, fetchImpl: impl,
    });

    await jar('https://api.authowl.dev/sign-out');
    expect(await storage.getItem(sessionStorageKey(PROJECT_ID))).toBeNull();
  });

  it('keeps the stored session when a response sets no cookie', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(sessionStorageKey(PROJECT_ID), 'tok_1');
    const { jar } = jarWith(storage);

    await jar('https://api.authowl.dev/get-session');
    expect(await storage.getItem(sessionStorageKey(PROJECT_ID))).toBe('tok_1');
  });

  it('uses the unprefixed cookie name against an insecure origin', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(sessionStorageKey(PROJECT_ID), 'tok_1');
    const { jar, calls } = jarWith(storage, false);

    await jar('http://localhost:3000/x');
    expect(cookieHeaderOf(calls[0]!)).toBe(`${PLAIN_COOKIE}=tok_1`);
  });
});

describe('createAuthOwlNative', () => {
  it('derives the project id from the publishable key', () => {
    const { projectId } = createAuthOwlNative({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: 'https://api.authowl.dev',
      storage: new MemoryStorage(),
    });
    expect(projectId).toBe(PROJECT_ID);
  });

  it('refuses a secret key at startup rather than shipping it in a binary', () => {
    expect(() => createAuthOwlNative({
      publishableKey: `sk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`,
      apiUrl: 'https://api.authowl.dev',
      storage: new MemoryStorage(),
    })).toThrow(/secret key/i);
  });
});
