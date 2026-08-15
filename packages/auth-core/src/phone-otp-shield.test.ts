import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const solvePow = vi.fn();
const getTurnstileToken = vi.fn();
vi.mock('@akedly/shield', () => ({ solvePow, getTurnstileToken }));

import { solvePhoneOtpChallenge } from './phone-otp-shield';

describe('solvePhoneOtpChallenge', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    solvePow.mockReset().mockResolvedValue({ nonce: 42 });
    getTurnstileToken.mockReset().mockResolvedValue('turnstile-token');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lazy-solves only the proof dimensions required by the server challenge', async () => {
    const result = await solvePhoneOtpChallenge({
      kind: 'akedly_shield_v1_2',
      connectionId: 'connection-1',
      challenge: 'a'.repeat(64),
      difficulty: 4,
      challengeToken: 'signed.challenge.token',
      challengeRequired: true,
      turnstile: { required: true, siteKey: '0x-site' },
    });

    expect(solvePow).toHaveBeenCalledWith('a'.repeat(64), 4);
    expect(getTurnstileToken).toHaveBeenCalledWith('0x-site');
    expect(result).toEqual({
      connectionId: 'connection-1',
      challengeToken: 'signed.challenge.token',
      nonce: 42,
      turnstileToken: 'turnstile-token',
    });
  });

  it('does not load unnecessary proof fields when the provider disables them', async () => {
    const result = await solvePhoneOtpChallenge({
      kind: 'akedly_shield_v1_2',
      connectionId: 'connection-1',
      challenge: 'a'.repeat(64),
      difficulty: 0,
      challengeToken: 'signed.challenge.token',
      challengeRequired: false,
      turnstile: { required: false, siteKey: null },
    });

    expect(result).toEqual({ connectionId: 'connection-1' });
    expect(solvePow).not.toHaveBeenCalled();
    expect(getTurnstileToken).not.toHaveBeenCalled();
  });

  it('refuses to run outside a browser instead of loading the provider package', async () => {
    vi.stubGlobal('window', undefined);

    await expect(solvePhoneOtpChallenge({
      kind: 'akedly_shield_v1_2',
      connectionId: 'connection-1',
      challenge: 'a'.repeat(64),
      difficulty: 4,
      challengeToken: 'signed.challenge.token',
      challengeRequired: true,
      turnstile: { required: false, siteKey: null },
    })).rejects.toThrow(/browser/i);
    expect(solvePow).not.toHaveBeenCalled();
  });

  it('fails when Turnstile is demanded without a site key rather than sending no token', async () => {
    // The server said a Turnstile token is required, so silently omitting one
    // would produce a request the provider must reject anyway - fail here, where
    // the cause is still visible.
    await expect(solvePhoneOtpChallenge({
      kind: 'akedly_shield_v1_2',
      connectionId: 'connection-1',
      challenge: 'a'.repeat(64),
      difficulty: 0,
      challengeToken: 'signed.challenge.token',
      challengeRequired: false,
      turnstile: { required: true, siteKey: null },
    })).rejects.toThrow(/site key/i);
    expect(getTurnstileToken).not.toHaveBeenCalled();
  });
});
