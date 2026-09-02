import { describe, expect, it, vi } from 'vitest';
import { createAuthOwlNextFetch } from './client';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const PUBLISHABLE_KEY = `pk_live_${PROJECT_ID}_A1b2C3d4E5f6G7h8I9j0`;
const API_URL = 'https://auth.example.com';

describe('createAuthOwlNextFetch', () => {
  it('is a transparent fetch until core connects the session integration', async () => {
    const response = Response.json({ user: { id: 'user_1' } });
    const base = vi.fn(async () => response);
    const integrated = createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: API_URL,
      fetch: base,
    });

    const received = await integrated('https://attacker.example/sign-in/email', {
      method: 'POST',
    });

    expect(received).toBe(response);
    expect(base).toHaveBeenCalledOnce();
    expect(base).toHaveBeenCalledWith('https://attacker.example/sign-in/email', {
      method: 'POST',
    });
  });

  it.each(['//evil.example/steal', '/\\evil.example/steal', '/session#fragment'])(
    'rejects an unsafe bridge path: %s',
    (bridgePath) => {
      expect(() => createAuthOwlNextFetch({
        publishableKey: PUBLISHABLE_KEY,
        apiUrl: API_URL,
        bridgePath,
        fetch: vi.fn(),
      })).toThrow('bridgePath must be a same-origin absolute path');
    },
  );

  it('uses core policy to reject an insecure live API origin', () => {
    expect(() => createAuthOwlNextFetch({
      publishableKey: PUBLISHABLE_KEY,
      apiUrl: 'http://localhost:3010',
      fetch: vi.fn(),
    })).toThrow(/HTTPS/i);
  });
});
