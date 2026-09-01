/**
 * Runs the language-neutral conformance corpus (`conformance/vectors/`) against
 * this package.
 *
 * `@authowl/core` is the REFERENCE implementation: the vectors were derived from
 * the semantics in this directory, so if this suite ever fails, either the
 * vectors or this implementation moved and the other SDKs are about to diverge.
 * Go, Python, PHP, and Rust run the backend vectors in their own test framework.
 * Dart/Flutter runs the client vectors it implements. That division keeps
 * server verification aligned without inventing a browser-side JWT verifier.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseJwksDocument, verifyProjectToken } from './token-verify';
import { projectBrowserAuthPayload } from './http-client';
import { sessionCookieName } from './cookie';
import { decodePublishableKey } from './key-decode';
import { membershipHas, membershipHasPermission } from './organization-membership';
import { verifyWebhook } from './webhook';
import { has as hasVerifiedGrant } from './server';

const VECTORS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../conformance/vectors',
);

function load<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(VECTORS, name), 'utf8')) as T;
}

const JWKS_PARSE_CODES = new Set([
  'JWKS_DOCUMENT_INVALID',
  'JWKS_TOO_MANY_KEYS',
  'JWKS_DUPLICATE_KID',
  'JWKS_KEY_INVALID',
]);

// ---------------------------------------------------------------------------

describe('conformance: project token verification', () => {
  type JwtVectors = {
    issuer: string;
    audience: string;
    jwks: { keys: unknown[] };
    cases: Array<{
      name: string;
      token: string;
      now: number;
      clockToleranceSeconds?: number;
      tokenUse?: 'session' | 'template' | 'access' | 'id';
      requireTokenUse?: boolean;
      authorization?: { permission: string; expect: boolean };
      expect:
        | { ok: true; sub: string | null; membership: unknown }
        | { ok: false; code: string };
    }>;
  };
  const vectors = load<JwtVectors>('jwt-verify.json');

  let jwksUriSequence = 0;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function arrange(now: number, document: unknown = vectors.jwks) {
    // Freeze the clock rather than faking timers: the transport's abort timeout
    // relies on a real setTimeout, and only Date.now() feeds the claim checks.
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    // A fresh Response per call: an unknown kid provokes a second, cache-bypassing
    // refetch, and a Response body can only be read once.
    const body = JSON.stringify(document);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(body, { headers: { 'content-type': 'application/json' } }));
    // A fresh URI per case defeats the module-level JWKS cache and the
    // unknown-kid refetch cooldown, so cases stay independent of ordering.
    jwksUriSequence += 1;
    return `https://keys.conformance.test/jwks-${jwksUriSequence}`;
  }

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
    const jwksUri = arrange(testCase.now);
    const options = {
      issuer: vectors.issuer,
      audience: vectors.audience,
      jwksUri,
      ...(testCase.clockToleranceSeconds === undefined
        ? {}
        : { clockToleranceSeconds: testCase.clockToleranceSeconds }),
      ...(testCase.tokenUse === undefined ? {} : { tokenUse: testCase.tokenUse }),
      ...(testCase.requireTokenUse === undefined
        ? {}
        : { requireTokenUse: testCase.requireTokenUse }),
    };

    if (testCase.expect.ok) {
      const verified = await verifyProjectToken(testCase.token, options);
      expect(verified.sub).toBe(testCase.expect.sub);
      expect(verified.membership).toEqual(testCase.expect.membership);
      if (testCase.authorization) {
        await expect(hasVerifiedGrant(
          testCase.token,
          { permission: testCase.authorization.permission },
          options,
        )).resolves.toBe(testCase.authorization.expect);
      }
    } else {
      await expect(verifyProjectToken(testCase.token, options)).rejects.toMatchObject({
        name: 'TokenVerificationError',
        code: testCase.expect.code,
      });
    }
  });
});

// ---------------------------------------------------------------------------

describe('conformance: JWKS document parsing', () => {
  type JwksVectors = {
    cases: Array<{
      name: string;
      document: unknown;
      expect: { ok: true; keys: number } | { ok: false; code: string };
    }>;
  };
  const vectors = load<JwksVectors>('jwks-parse.json');

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    if (testCase.expect.ok) {
      expect(parseJwksDocument(testCase.document)).toHaveLength(testCase.expect.keys);
    } else {
      let code: string | undefined;
      try {
        parseJwksDocument(testCase.document);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe(testCase.expect.code);
      expect(JWKS_PARSE_CODES.has(testCase.expect.code)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('conformance: session cookie name', () => {
  type CookieVectors = {
    cases: Array<{ name: string; projectId: string; secure?: boolean; expect: string }>;
  };
  const vectors = load<CookieVectors>('cookie-name.json');

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const actual = testCase.secure === undefined
      ? sessionCookieName(testCase.projectId)
      : sessionCookieName(testCase.projectId, { secure: testCase.secure });
    expect(actual).toBe(testCase.expect);
  });
});

// ---------------------------------------------------------------------------

describe('conformance: publishable key decoding', () => {
  type KeyVectors = {
    cases: Array<{
      name: string;
      key: string;
      expect:
        | { ok: true; prefix: string; env: string; projectId: string }
        | { ok: false; reason: 'missing' | 'secret_key' | 'malformed' };
    }>;
  };
  const vectors = load<KeyVectors>('publishable-key.json');

  /** Collapse the thrown message to the portable reason every SDK reports. */
  function reasonOf(message: string): string {
    if (message.includes('is required')) return 'missing';
    if (message.includes('secret key')) return 'secret_key';
    if (message.includes('malformed')) return 'malformed';
    return `unclassified: ${message}`;
  }

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    if (testCase.expect.ok) {
      expect(decodePublishableKey(testCase.key)).toEqual({
        prefix: testCase.expect.prefix,
        env: testCase.expect.env,
        projectId: testCase.expect.projectId,
      });
    } else {
      let reason: string | undefined;
      try {
        decodePublishableKey(testCase.key);
      } catch (error) {
        reason = reasonOf((error as Error).message);
      }
      expect(reason).toBe(testCase.expect.reason);
    }
  });
});

// ---------------------------------------------------------------------------

describe('conformance: membership evaluation', () => {
  type MembershipVectors = {
    hasCases: Array<{ name: string; membership: never; params: never; expect: boolean }>;
    hasPermissionCases: Array<{
      name: string;
      membership: never;
      permission: string;
      expect: boolean;
    }>;
  };
  const vectors = load<MembershipVectors>('membership-has.json');

  it.each(vectors.hasCases.map((c) => [c.name, c] as const))('has: %s', (_name, testCase) => {
    expect(membershipHas(testCase.membership, testCase.params)).toBe(testCase.expect);
  });

  it.each(vectors.hasPermissionCases.map((c) => [c.name, c] as const))(
    'hasPermission: %s',
    (_name, testCase) => {
      expect(membershipHasPermission(testCase.membership, testCase.permission))
        .toBe(testCase.expect);
    },
  );
});

// ---------------------------------------------------------------------------

describe('conformance: durable session-token projection', () => {
  type ProjectionVectors = {
    cases: Array<{ name: string; path: string; payload: unknown; expect: unknown }>;
  };
  const vectors = load<ProjectionVectors>('response-projection.json');

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    expect(projectBrowserAuthPayload(testCase.path, testCase.payload))
      .toEqual(testCase.expect);
  });
});

describe('conformance: webhook signature verification', () => {
  type WebhookVectors = {
    cases: Array<{
      name: string;
      rawBody: string;
      timestamp: string;
      signatureHeader: string;
      secrets: string[];
      now: number;
      toleranceSeconds?: number;
      expect: { result: boolean } | { throws: true };
    }>;
  };
  const vectors = load<WebhookVectors>('webhook-verify.json');

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
    const input = {
      rawBody: testCase.rawBody,
      timestamp: testCase.timestamp,
      signatureHeader: testCase.signatureHeader,
      secrets: testCase.secrets,
      now: testCase.now,
      ...(testCase.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: testCase.toleranceSeconds }),
    };

    if ('throws' in testCase.expect) {
      // Local misconfiguration is LOUD; only untrusted input degrades to false.
      await expect(verifyWebhook(input)).rejects.toThrow();
    } else {
      await expect(verifyWebhook(input)).resolves.toBe(testCase.expect.result);
    }
  });
});
