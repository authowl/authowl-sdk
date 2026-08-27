/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setActiveLocale } from './active-locale';
import { resolveConfig } from './config';
import { AUTH_LOCALE_HEADER, createAuthHttpClient } from './http-client';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const PK = `pk_live_${PROJECT_ID}_abcdefghij0123456789`;

afterEach(() => {
  setActiveLocale(PROJECT_ID, null);
});

describe('request locale', () => {
  it('sends the active project locale on the actual HTTP request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    const release = setActiveLocale(PROJECT_ID, 'ar');
    const http = createAuthHttpClient(
      resolveConfig({
        publishableKey: PK,
        apiUrl: 'https://auth.example.com',
        fetch: fetchImpl,
      }),
    );

    await http.request('/sign-up/email', { method: 'POST', body: {} });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get(AUTH_LOCALE_HEADER)).toBe('ar');
    release();
  });
});
