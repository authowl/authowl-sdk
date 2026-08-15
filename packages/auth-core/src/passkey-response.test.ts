import { describe, expect, it } from 'vitest';
import {
  decodeAuthenticationOptions,
  decodeDeletedPasskey,
  decodePasskey,
  decodePasskeyAuthentication,
  decodePasskeys,
  decodeRegisteredPasskey,
  decodeRegistrationOptions,
  decodeUpdatedPasskey,
} from './passkey-response';

const now = new Date('2026-07-26T08:00:00.000Z');
const challenge = 'AAAAAAAAAAAAAAAAAAAAAA';
const credentialId = 'Y3JlZGVudGlhbC0xMjM';
const user = {
  id: 'user-1',
  email: 'mona@example.test',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  privateMetadata: { drop: true },
};
const session = {
  id: 'session-1',
  userId: 'user-1',
  expiresAt: now,
  token: 'durable-session-secret',
};
const passkey = {
  id: 'passkey-1',
  name: 'Laptop',
  publicKey: 'cHVibGljLWtleS1tYXRlcmlhbA==',
  userId: 'user-1',
  credentialID: credentialId,
  counter: 3,
  deviceType: 'multiDevice',
  backedUp: true,
  transports: 'internal',
  createdAt: now,
  aaguid: '00000000-0000-0000-0000-000000000000',
  projectId: 'drop-me',
  privateKey: 'must-not-survive',
};

describe('passkey response contracts', () => {
  it('projects ceremony fields while preserving bounded extension inputs', () => {
    const authentication = {
      challenge,
      timeout: 60_000,
      rpId: 'app.example.test',
      allowCredentials: [{
        id: credentialId,
        type: 'public-key',
        transports: ['internal', 'hybrid'],
      }],
      userVerification: 'preferred',
      hints: ['client-device'],
      extensions: { prf: { eval: { first: 'salt_123' } } },
      futureMode: { enabled: true },
    };
    const registration = {
      challenge: 'BBBBBBBBBBBBBBBBBBBBBA',
      rp: { id: 'app.example.test', name: 'Example', icon: 'future-icon' },
      user: {
        id: 'dXNlci0x',
        name: 'mona@example.test',
        displayName: 'Mona',
        privateMetadata: 'drop-me',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        requireResidentKey: false,
        userVerification: 'required',
      },
      attestation: 'none',
      attestationFormats: ['packed'],
      extensions: { credProps: true },
      futureMode: { enabled: true },
    };

    expect(decodeAuthenticationOptions(authentication)).toEqual({
      challenge: authentication.challenge,
      timeout: authentication.timeout,
      rpId: authentication.rpId,
      allowCredentials: authentication.allowCredentials,
      userVerification: authentication.userVerification,
      hints: authentication.hints,
      extensions: authentication.extensions,
    });
    expect(decodeRegistrationOptions(registration)).toEqual({
      challenge: registration.challenge,
      rp: { id: 'app.example.test', name: 'Example' },
      user: {
        id: 'dXNlci0x',
        name: 'mona@example.test',
        displayName: 'Mona',
      },
      pubKeyCredParams: registration.pubKeyCredParams,
      authenticatorSelection: registration.authenticatorSelection,
      attestation: registration.attestation,
      attestationFormats: registration.attestationFormats,
      extensions: registration.extensions,
    });
    expect(
      decodeAuthenticationOptions(authentication).extensions,
    ).not.toBe(authentication.extensions);
  });

  it('rejects malformed ceremony invariants before WebAuthn sees them', () => {
    const malformed = [
      () => decodeAuthenticationOptions({ challenge: '' }),
      () => decodeAuthenticationOptions({ challenge: 'not base64url!' }),
      () => decodeAuthenticationOptions({ challenge: 'AAAAA' }),
      () => decodeAuthenticationOptions({ challenge: 'AAAAAAAAAAAAAAAAAAAAAB' }),
      () => decodeAuthenticationOptions({
        challenge,
        timeout: Number.POSITIVE_INFINITY,
      }),
      () => decodeAuthenticationOptions({
        challenge,
        allowCredentials: [{ id: 'credential', type: 'password' }],
      }),
      () => decodeAuthenticationOptions({
        challenge,
        allowCredentials: [
          { id: credentialId, type: 'public-key' },
          { id: credentialId, type: 'public-key' },
        ],
      }),
      () => decodeAuthenticationOptions({
        challenge,
        allowCredentials: [{
          id: credentialId,
          type: 'public-key',
          transports: ['internal', 'internal'],
        }],
      }),
      () => decodeAuthenticationOptions({
        challenge,
        rpId: 'https://app.example.test',
      }),
      () => decodeAuthenticationOptions({
        challenge,
        hints: ['unknown-hint'],
      }),
      () => decodeRegistrationOptions({
        challenge,
        rp: { name: 'Example' },
        user: { id: 'not base64!', name: 'Mona', displayName: 'Mona' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      }),
      () => decodeRegistrationOptions({
        challenge,
        rp: { name: 'Example' },
        user: { id: 'dXNlcg', name: 'Mona', displayName: 'Mona' },
        pubKeyCredParams: [],
      }),
      () => decodeRegistrationOptions({
        challenge,
        rp: { name: 'Example' },
        user: { id: 'dXNlcg', name: 'Mona', displayName: 'Mona' },
        pubKeyCredParams: [{ type: 'public-key', alg: -65535 }],
      }),
      () => decodeRegistrationOptions({
        challenge,
        rp: { name: 'Example' },
        user: { id: 'dXNlcg', name: 'Mona', displayName: 'Mona' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -7 },
        ],
      }),
      () => decodeRegistrationOptions({
        challenge,
        rp: { name: 'Example' },
        user: {
          id: 'dXNlcg',
          name: 'Mona\u202e',
          displayName: 'Mona',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      }),
      () => decodeRegistrationOptions({
        challenge,
        rp: { name: 'Example' },
        user: { id: 'dXNlcg', name: 'Mona', displayName: 'Mona' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          residentKey: 'preferred',
          requireResidentKey: true,
        },
      }),
    ];

    for (const decode of malformed) expect(decode).toThrow(TypeError);
  });

  it('rejects hostile ceremony object shapes and extension budgets', () => {
    const classInstance = new (class Options {
      challenge = challenge;
    })();
    const polluted = Object.create({ inherited: true }) as Record<string, unknown>;
    polluted.challenge = challenge;
    const deepExtension: Record<string, unknown> = {};
    let cursor = deepExtension;
    for (let depth = 0; depth < 10; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }

    for (const value of [null, [], classInstance, polluted]) {
      expect(() => decodeAuthenticationOptions(value)).toThrow(TypeError);
    }
    expect(() => decodeAuthenticationOptions({
      challenge,
      extensions: deepExtension,
    })).toThrow(TypeError);
  });

  it('projects authenticated state exactly and binds session to user', () => {
    expect(decodePasskeyAuthentication({
      session,
      user,
      token: 'top-level-secret',
      serverOnly: 'drop-me',
    })).toEqual({
      session: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: now,
      },
      user: {
        id: 'user-1',
        email: 'mona@example.test',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(() => decodePasskeyAuthentication({
      session: { ...session, userId: 'other-user' },
      user,
    })).toThrow(TypeError);
  });

  it('projects exact passkey rows and rejects malformed or duplicate identity', () => {
    const expected = {
      id: 'passkey-1',
      name: 'Laptop',
      publicKey: 'cHVibGljLWtleS1tYXRlcmlhbA==',
      userId: 'user-1',
      credentialID: credentialId,
      counter: 3,
      deviceType: 'multiDevice',
      backedUp: true,
      transports: 'internal',
      createdAt: now,
      aaguid: '00000000-0000-0000-0000-000000000000',
    };
    expect(decodePasskey(passkey)).toEqual(expected);
    expect(
      decodeRegisteredPasskey(passkey, credentialId, 'Laptop'),
    ).toEqual(expected);
    expect(
      decodeRegisteredPasskey(
        { ...passkey, name: null },
        credentialId,
        undefined,
      ).name,
    ).toBeNull();
    expect(decodePasskey({
      ...passkey,
      name: '😀'.repeat(256),
    }).name).toBe('😀'.repeat(256));
    expect(decodeUpdatedPasskey({ passkey }, 'passkey-1', 'Laptop')).toEqual({
      passkey: expected,
    });
    expect(decodeDeletedPasskey({ status: true, token: 'drop-me' })).toEqual({
      status: true,
    });

    expect(() => decodePasskey({ ...passkey, counter: -1 })).toThrow(TypeError);
    expect(() => decodePasskey({ ...passkey, publicKey: 'not base64' })).toThrow(
      TypeError,
    );
    expect(() => decodePasskey({ ...passkey, credentialID: 'not+url' })).toThrow(
      TypeError,
    );
    expect(() => decodePasskey({ ...passkey, deviceType: 'unknown' })).toThrow(
      TypeError,
    );
    expect(() => decodePasskey({
      ...passkey,
      deviceType: 'singleDevice',
      backedUp: true,
    })).toThrow(TypeError);
    expect(() => decodePasskey({ ...passkey, transports: 'internal,internal' }))
      .toThrow(TypeError);
    expect(() => decodePasskey({ ...passkey, aaguid: 'not-a-uuid' })).toThrow(
      TypeError,
    );
    expect(() => decodePasskey({ ...passkey, name: '' })).toThrow(TypeError);
    expect(() => decodePasskey({ ...passkey, name: 'x'.repeat(257) })).toThrow(
      TypeError,
    );
    expect(() => decodePasskey({
      ...passkey,
      name: '😀'.repeat(257),
    })).toThrow(TypeError);
    for (const name of [
      '\u00a0Laptop',
      '\ufeffLaptop',
      'Laptop\u061c',
      'Laptop\u200e',
      'Laptop\u200f',
      'Laptop\ud800',
    ]) {
      expect(() => decodePasskey({ ...passkey, name })).toThrow(TypeError);
    }
    expect(() => decodePasskey({ ...passkey, createdAt: 'not-a-date' })).toThrow(
      TypeError,
    );
    expect(() => decodeUpdatedPasskey(
      { passkey },
      'other-passkey',
      'Laptop',
    )).toThrow(
      TypeError,
    );
    expect(() => decodeUpdatedPasskey(
      { passkey },
      'passkey-1',
      'Wrong name',
    )).toThrow(TypeError);
    expect(() => decodeRegisteredPasskey(
      passkey,
      'Y3JlZGVudGlhbC00NTY',
      'Laptop',
    )).toThrow(TypeError);
    expect(() => decodeRegisteredPasskey(
      passkey,
      credentialId,
      'Wrong name',
    )).toThrow(TypeError);
    expect(() => decodeRegisteredPasskey(
      passkey,
      credentialId,
      undefined,
    )).toThrow(TypeError);
    expect(() => decodeDeletedPasskey({ status: false })).toThrow(TypeError);
    expect(() => decodePasskeys([
      passkey,
      { ...passkey, id: 'passkey-2' },
    ])).toThrow(TypeError);
    expect(() => decodePasskeys([
      passkey,
      {
        ...passkey,
        id: 'passkey-2',
        credentialID: 'Y3JlZGVudGlhbC00NTY',
        userId: 'other-user',
      },
    ])).toThrow(TypeError);
  });
});
