import { describe, expect, it } from 'vitest';
import {
  decodeEmailOtpSignIn,
  decodeEmailSignIn,
  decodeEmailSignUp,
  decodeMagicLink,
  decodePasswordReset,
  decodePhoneOtpStart,
  decodePhoneOtpChallenge,
  decodePhoneOtpVerify,
  decodeSendOtp,
  decodeSendTwoFactorOtp,
  decodeSignOut,
  decodeSocialSignIn,
  decodeSsoSignIn,
  decodeTwoFactorBackupCodes,
  decodeTwoFactorEnable,
  decodeTwoFactorStatus,
  decodeTwoFactorVerify,
  decodeVerificationEmail,
  decodeVerifyEmailOtp,
  MAX_PROOF_OF_WORK_DIFFICULTY,
} from './auth-action-response';

const now = new Date('2026-07-26T08:00:00.000Z');
const userWire = {
  id: 'user-1',
  email: 'mona@example.test',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  name: 'Mona',
  username: 'mona',
  displayUsername: 'Mona',
  firstName: 'Mona',
  lastName: 'Ali',
  privateMetadata: { role: 'operator' },
  serverOnly: 'drop-me',
};

describe('auth action response projection', () => {
  it('projects credential and signup responses to their exact public unions', () => {
    expect(decodeEmailSignIn({
      redirect: false,
      url: null,
      user: userWire,
      token: 'durable-session-secret',
      refreshToken: 'drop-me',
    })).toEqual({
      redirect: false,
      user: publicUser(),
    });
    expect(decodeEmailSignIn({
      twoFactorRedirect: true,
      twoFactorMethods: ['totp', 'otp'],
      token: 'durable-session-secret',
      serverOnly: 'drop-me',
    })).toEqual({
      twoFactorRedirect: true,
      twoFactorMethods: ['totp', 'otp'],
    });
    expect(decodeEmailOtpSignIn({
      token: 'durable-session-secret',
      user: userWire,
    })).toEqual({
      user: publicUser(),
    });
    expect(decodeEmailSignUp({
      token: 'durable-session-secret',
      sessionCreated: true,
      user: userWire,
      url: 'https://must-not-survive.example',
    })).toEqual({
      sessionCreated: true,
      user: publicUser(),
    });
  });

  it('projects all three legitimate social branches and strict redirect-only SSO', () => {
    expect(decodeSocialSignIn({
      redirect: true,
      url: 'https://idp.example.test/authorize',
      accessToken: 'drop-me',
    }, false)).toEqual({
      redirect: true,
      url: 'https://idp.example.test/authorize',
    });
    expect(decodeSocialSignIn({
      redirect: false,
      url: 'https://idp.example.test/authorize',
      refreshToken: 'drop-me',
    }, false)).toEqual({
      redirect: false,
      url: 'https://idp.example.test/authorize',
    });
    expect(decodeSocialSignIn({
      redirect: false,
      user: userWire,
      token: 'durable-session-secret',
    }, false)).toEqual({
      redirect: false,
      user: publicUser(),
    });
    expect(decodeSsoSignIn({
      redirect: true,
      url: 'https://sso.example.test/authorize',
      projectId: 'drop-me',
    }, false)).toEqual({
      redirect: true,
      url: 'https://sso.example.test/authorize',
    });
  });

  it('accepts only safe absolute navigation URLs', () => {
    const decode = (url: string, allowHttpLoopback = false) =>
      decodeSocialSignIn({ redirect: true, url }, allowHttpLoopback);

    expect(decode('https://idp.example.test/authorize')).toMatchObject({
      url: 'https://idp.example.test/authorize',
    });
    expect(decode('http://localhost:3010/callback', true)).toMatchObject({
      url: 'http://localhost:3010/callback',
    });
    expect(decode('http://127.0.0.1/callback', true)).toMatchObject({
      url: 'http://127.0.0.1/callback',
    });
    expect(decode('http://[::1]/callback', true)).toMatchObject({
      url: 'http://[::1]/callback',
    });

    for (const unsafe of [
      'javascript:alert(1)',
      'data:text/html,owned',
      'file:///tmp/owned',
      'http://idp.example.test/authorize',
      'https://user:password@idp.example.test/authorize',
      'https://idp.example.test/authorize\n',
      'https://idp.example.test/oauth authorize',
      'http://localhost.evil.test/callback',
      'http://127.0.0.2/callback',
      '/relative',
      'not a url',
    ]) {
      expect(() => decode(unsafe, true), unsafe).toThrow(TypeError);
    }
    expect(() => decode('http://localhost/callback', false)).toThrow(TypeError);
  });

  it('projects status actions and intentionally drops reset messages', () => {
    expect(decodeMagicLink({ status: true, token: 'drop-me' })).toEqual({
      status: true,
    });
    expect(decodeSendOtp({ success: true, otp: 'drop-me' })).toEqual({
      success: true,
    });
    expect(decodePhoneOtpStart({ status: 'pending', provider: 'drop-me' })).toEqual({
      status: 'pending',
    });
    expect(decodePhoneOtpChallenge({ kind: 'authowl_turnstile', secret: 'drop-me' })).toEqual({
      kind: 'authowl_turnstile',
    });
    expect(decodePhoneOtpChallenge({
      kind: 'akedly_shield_v1_2',
      connectionId: 'connection-1',
      challenge: 'a'.repeat(64),
      difficulty: 4,
      challengeToken: 'signed.challenge.token',
      challengeRequired: true,
      turnstile: { required: true, siteKey: '0x-site' },
      apiKey: 'drop-me',
    })).toEqual({
      kind: 'akedly_shield_v1_2',
      connectionId: 'connection-1',
      challenge: 'a'.repeat(64),
      difficulty: 4,
      challengeToken: 'signed.challenge.token',
      challengeRequired: true,
      turnstile: { required: true, siteKey: '0x-site' },
    });
    expect(decodePasswordReset({
      status: true,
      message: 'If the email exists...',
      token: 'drop-me',
    })).toEqual({ status: true });
    expect(decodeVerificationEmail({ status: true, message: 'drop-me' })).toEqual({
      status: true,
    });
    expect(decodeVerifyEmailOtp({
      status: true,
      token: 'drop-me',
      user: userWire,
    })).toEqual({
      status: true,
      user: publicUser(),
    });
    expect(decodeSignOut({ success: true, token: 'drop-me' })).toEqual({
      success: true,
    });
    expect(decodeTwoFactorStatus({ status: false, serverOnly: 'drop-me' })).toEqual({
      status: false,
    });
    expect(decodeSendTwoFactorOtp({ status: true, otp: 'drop-me' })).toEqual({
      status: true,
    });
    expect(decodeTwoFactorVerify({
      status: true,
      token: 'durable-session-secret',
      user: userWire,
    })).toEqual({ status: true });
  });

  it('projects phone verification to the exact phone-safe user', () => {
    expect(decodePhoneOtpVerify({
      status: true,
      sessionCreated: true,
      token: 'durable-session-secret',
      user: {
        id: 'phone-user',
        email: 'synthetic@internal.invalid',
        name: null,
        phoneNumber: '+201000000000',
        phoneNumberVerified: true,
        createdAt: now,
        updatedAt: now,
        privateMetadata: { role: 'drop-me' },
      },
    })).toEqual({
      status: true,
      sessionCreated: true,
      user: {
        id: 'phone-user',
        name: null,
        phoneNumber: '+201000000000',
        phoneNumberVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  it('validates and narrowly returns the intentional one-time MFA secrets', () => {
    const totpURI =
      'otpauth://totp/AuthOwl:mona@example.test?secret=ABC234&issuer=AuthOwl';
    expect(decodeTwoFactorEnable({
      totpURI,
      backupCodes: ['alpha-1', 'bravo-2'],
      encryptedSecret: 'drop-me',
    })).toEqual({
      totpURI,
      backupCodes: ['alpha-1', 'bravo-2'],
    });
    expect(decodeTwoFactorBackupCodes({
      status: true,
      backupCodes: ['charlie-3', 'delta-4'],
      oldBackupCodes: ['drop-me'],
    })).toEqual({
      backupCodes: ['charlie-3', 'delta-4'],
    });

    expect(() => decodeTwoFactorEnable({
      totpURI: 'https://example.test/not-otpauth',
      backupCodes: ['alpha-1'],
    })).toThrow(TypeError);
    expect(() => decodeTwoFactorEnable({
      totpURI,
      backupCodes: ['duplicate', 'duplicate'],
    })).toThrow(TypeError);
    expect(() => decodeTwoFactorBackupCodes({
      status: false,
      backupCodes: ['alpha-1'],
    })).toThrow(TypeError);
  });

  it('rejects ambiguous unions and malformed required fields', () => {
    const malformed = [
      () => decodeEmailSignIn({
        twoFactorRedirect: true,
        user: userWire,
      }),
      () => decodeEmailSignIn({
        redirect: false,
        user: { id: 'incomplete' },
      }),
      () => decodeSocialSignIn({
        redirect: false,
        url: 'https://idp.example.test',
        user: userWire,
      }, false),
      () => decodeSocialSignIn({ redirect: false }, false),
      () => decodeSsoSignIn({
        redirect: false,
        url: 'https://idp.example.test',
      }, false),
      () => decodePhoneOtpStart({ status: true }),
      () => decodePhoneOtpChallenge({
        kind: 'akedly_shield_v1_2', difficulty: -1, turnstile: {},
      }),
      // An unbounded difficulty would hang the browser's main thread inside
      // solvePow, so the client refuses the challenge rather than attempting it.
      () => decodePhoneOtpChallenge({
        kind: 'akedly_shield_v1_2',
        connectionId: 'connection-1',
        challenge: 'a'.repeat(64),
        difficulty: MAX_PROOF_OF_WORK_DIFFICULTY + 1,
        challengeToken: 'signed.challenge.token',
        challengeRequired: true,
        turnstile: { required: false, siteKey: null },
      }),
      () => decodePhoneOtpChallenge({
        kind: 'akedly_shield_v1_2',
        connectionId: 'connection-1',
        challenge: 'a'.repeat(64),
        difficulty: Number.MAX_SAFE_INTEGER,
        challengeToken: 'signed.challenge.token',
        challengeRequired: true,
        turnstile: { required: false, siteKey: null },
      }),
      () => decodePhoneOtpVerify({
        status: true,
        sessionCreated: false,
        user: {},
      }),
      () => decodeTwoFactorVerify({ status: false }),
    ];

    for (const decode of malformed) expect(decode).toThrow(TypeError);
  });
});

function publicUser() {
  return {
    id: 'user-1',
    email: 'mona@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    name: 'Mona',
    username: 'mona',
    displayUsername: 'Mona',
    firstName: 'Mona',
    lastName: 'Ali',
  };
}
