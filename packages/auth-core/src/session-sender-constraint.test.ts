/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://app.tenant.test/" }
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config';
import {
  clearSessionProofKeyMemoryForTests,
  sessionProofKey,
} from './session-proof-client';
import {
  sessionBindingStorageKey,
  sessionTokenStorageKey,
} from './session-token';

const API = 'https://auth.authowl.test';
const TOKEN = 'session-value.signature';
let projectCounter = 0;

const freshProject = () =>
  `22222222-2222-4222-8222-${String(++projectCounter).padStart(12, '0')}`;

type RecordedCall = { url: URL; method: string; headers: Headers };

function base64Json(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64Bytes(value))) as Record<string, unknown>;
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

function proofClaims(proof: string): Record<string, unknown> {
  return base64Json(proof.split('.')[1]!);
}

async function expectedHash(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function transportEngine(cookieSupported: boolean) {
  const calls: RecordedCall[] = [];
  const engineFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ url, method, headers });
    if (url.pathname.endsWith('/session/cookie-capability')) {
      if (method === 'POST') return new Response(null, { status: 204 });
      return Response.json({ cookieSupported });
    }
    if (url.pathname.endsWith('/session/abandon')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/sign-in/email')) {
      return Response.json(
        { ok: true },
        { headers: cookieSupported ? undefined : { 'set-auth-token': TOKEN } },
      );
    }
    return Response.json({ ok: true });
  }) as typeof fetch;
  return { calls, fetch: engineFetch };
}

function configFor(projectId: string, provided: typeof fetch) {
  return resolveConfig({
    publishableKey: `pk_test_${projectId}_abcdefghijklmnopqrstuvwxyz012345`,
    apiUrl: API,
    fetch: provided,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearSessionProofKeyMemoryForTests();
});

describe('browser session sender constraint', () => {
  it('keeps a cookie-capable browser cookie-only before the session is minted', async () => {
    const projectId = freshProject();
    const engine = transportEngine(true);
    const config = configFor(projectId, engine.fetch);

    await config.session.prepareSession({ remember: true });
    await config.fetch(`${config.projectBaseURL}/sign-in/email`, { method: 'POST' });

    const mint = engine.calls.find((call) => call.url.pathname.endsWith('/sign-in/email'))!;
    expect(mint.headers.has('authorization')).toBe(false);
    expect(mint.headers.has('x-authowl-session-transport')).toBe(false);
    expect(mint.headers.has('x-authowl-session-binding')).toBe(false);
    expect(mint.headers.has('x-authowl-session-proof')).toBe(false);
    expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
  });

  it('binds bearer delivery before mint and proves every later request', async () => {
    const projectId = freshProject();
    const engine = transportEngine(false);
    const config = configFor(projectId, engine.fetch);

    await config.session.prepareSession({ remember: true });
    await config.fetch(`${config.projectBaseURL}/sign-in/email?ignored=1`, { method: 'POST' });
    await config.fetch(`${config.projectBaseURL}/get-session?refresh=1`);
    await config.fetch(`${config.projectBaseURL}/get-session?refresh=2`);

    const mint = engine.calls.find((call) => call.url.pathname.endsWith('/sign-in/email'))!;
    const nonce = mint.headers.get('x-authowl-session-binding')!;
    const mintProof = mint.headers.get('x-authowl-session-proof')!;
    const [protectedHeader, payload, signature] = mintProof.split('.');
    const proofHeader = base64Json(protectedHeader!);
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      proofHeader.jwk as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    expect(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64Bytes(signature!),
      new TextEncoder().encode(`${protectedHeader}.${payload}`),
    )).toBe(true);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proofClaims(mintProof)).toMatchObject({
      htm: 'POST',
      htu: `${config.projectBaseURL}/sign-in/email`,
      ath: await expectedHash(nonce),
    });

    const reads = engine.calls.filter((call) => call.url.pathname.endsWith('/get-session'));
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(read.headers.has('x-authowl-session-binding')).toBe(false);
      expect(proofClaims(read.headers.get('x-authowl-session-proof')!)).toMatchObject({
        htm: 'GET',
        htu: `${config.projectBaseURL}/get-session`,
        ath: await expectedHash(TOKEN),
      });
    }
    expect(proofClaims(reads[0]!.headers.get('x-authowl-session-proof')!).jti)
      .not.toBe(proofClaims(reads[1]!.headers.get('x-authowl-session-proof')!).jti);
    // jsdom has no IndexedDB. The private key therefore lasts only for this tab,
    // and the token is narrowed to the same lifetime rather than outliving it.
    expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBe(TOKEN);
    expect(sessionStorage.getItem(sessionBindingStorageKey(projectId))).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('keeps the binding intent through a first factor that returns only a challenge', async () => {
    const projectId = freshProject();
    const calls: RecordedCall[] = [];
    const provided = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      calls.push({ url, method, headers });
      if (url.pathname.endsWith('/session/cookie-capability')) {
        return method === 'POST'
          ? new Response(null, { status: 204 })
          : Response.json({ cookieSupported: false });
      }
      if (url.pathname.endsWith('/sign-in/email')) {
        return Response.json({ twoFactorRedirect: true }, {
          headers: { 'set-auth-challenge': 'ticket=value' },
        });
      }
      return Response.json({ status: true }, { headers: { 'set-auth-token': TOKEN } });
    }) as typeof fetch;
    const config = configFor(projectId, provided);

    await config.session.prepareSession({ remember: false });
    await config.fetch(`${config.projectBaseURL}/sign-in/email`, { method: 'POST' });
    await config.fetch(`${config.projectBaseURL}/two-factor/verify-totp`, { method: 'POST' });

    const first = calls.find((call) => call.url.pathname.endsWith('/sign-in/email'))!;
    const verify = calls.find((call) => call.url.pathname.endsWith('/two-factor/verify-totp'))!;
    expect(verify.headers.get('x-authowl-session-binding'))
      .toBe(first.headers.get('x-authowl-session-binding'));
    expect(proofClaims(verify.headers.get('x-authowl-session-proof')!)).toMatchObject({
      htm: 'POST',
      htu: `${config.projectBaseURL}/two-factor/verify-totp`,
    });
    expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBe(TOKEN);
    expect(localStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
  });

  it('uses distinct proofs when a bound session mints its replacement', async () => {
    const projectId = freshProject();
    const engine = transportEngine(false);
    const config = configFor(projectId, engine.fetch);
    const mintUrl = `${config.projectBaseURL}/sign-in/email`;
    await config.session.prepareSession({ remember: true });
    await config.fetch(mintUrl, { method: 'POST' });

    await config.session.prepareSession({ remember: true });
    await config.fetch(mintUrl, { method: 'POST' });

    const replacements = engine.calls.filter((call) => call.url.pathname.endsWith('/sign-in/email'));
    const replacement = replacements[1]!;
    const nonce = replacement.headers.get('x-authowl-session-binding')!;
    expect(replacement.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(proofClaims(replacement.headers.get('x-authowl-session-proof')!).ath)
      .toBe(await expectedHash(TOKEN));
    expect(proofClaims(replacement.headers.get('x-authowl-session-binding-proof')!).ath)
      .toBe(await expectedHash(nonce));
    expect(replacement.headers.get('x-authowl-session-proof'))
      .not.toBe(replacement.headers.get('x-authowl-session-binding-proof'));
  });

  it('uses a mint proof after abandoning a session whose proof key was lost', async () => {
    const projectId = freshProject();
    const engine = transportEngine(false);
    const config = configFor(projectId, engine.fetch);
    const mintUrl = `${config.projectBaseURL}/sign-in/email`;
    await config.session.prepareSession({ remember: true });
    await config.fetch(mintUrl, { method: 'POST' });

    clearSessionProofKeyMemoryForTests();
    await config.session.prepareSession({ remember: true });
    await config.fetch(mintUrl, { method: 'POST' });

    const replacement = engine.calls
      .filter((call) => call.url.pathname.endsWith('/sign-in/email'))[1]!;
    const nonce = replacement.headers.get('x-authowl-session-binding')!;
    expect(replacement.headers.has('authorization')).toBe(false);
    expect(replacement.headers.has('x-authowl-session-binding-proof')).toBe(false);
    expect(proofClaims(replacement.headers.get('x-authowl-session-proof')!).ath)
      .toBe(await expectedHash(nonce));
    expect(engine.calls.filter((call) => call.url.pathname.endsWith('/session/abandon')))
      .toHaveLength(1);
  });

  it('does not sign out the current session when reauthentication credentials are wrong', async () => {
    const projectId = freshProject();
    let mintCount = 0;
    const calls: RecordedCall[] = [];
    const provided = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      calls.push({ url, method, headers });
      if (url.pathname.endsWith('/session/cookie-capability')) {
        return method === 'POST'
          ? new Response(null, { status: 204 })
          : Response.json({ cookieSupported: false });
      }
      if (url.pathname.endsWith('/sign-in/email')) {
        mintCount += 1;
        return mintCount === 1
          ? Response.json({ ok: true }, { headers: { 'set-auth-token': TOKEN } })
          : Response.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const config = configFor(projectId, provided);
    const mintUrl = `${config.projectBaseURL}/sign-in/email`;
    await config.session.prepareSession({ remember: true });
    await config.fetch(mintUrl, { method: 'POST' });
    await config.session.prepareSession({ remember: true });
    await config.fetch(mintUrl, { method: 'POST' });
    await config.fetch(`${config.projectBaseURL}/get-session`);

    const read = calls.find((call) => call.url.pathname.endsWith('/get-session'))!;
    expect(read.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(calls.some((call) => call.url.pathname.endsWith('/session/abandon'))).toBe(false);
  });

  it('abandons exactly the paired token when the browser key is lost', async () => {
    const projectId = freshProject();
    const engine = transportEngine(false);
    const config = configFor(projectId, engine.fetch);
    await config.session.prepareSession({ remember: true });
    await config.fetch(`${config.projectBaseURL}/sign-in/email`, { method: 'POST' });

    clearSessionProofKeyMemoryForTests();
    await config.fetch(`${config.projectBaseURL}/get-session`);

    const abandonment = engine.calls.find((call) => call.url.pathname.endsWith('/session/abandon'))!;
    expect(abandonment.method).toBe('POST');
    expect(abandonment.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(abandonment.headers.get('x-authowl-session-transport')).toBe('bearer');
    expect(abandonment.headers.has('x-authowl-session-proof')).toBe(false);
    const read = engine.calls.find((call) => call.url.pathname.endsWith('/get-session'))!;
    expect(read.headers.has('authorization')).toBe(false);
    expect(sessionStorage.getItem(sessionTokenStorageKey(projectId))).toBeNull();
    expect(sessionStorage.getItem(sessionBindingStorageKey(projectId))).toBeNull();
  });

  it('shares one origin key across clients and tabs', async () => {
    const first = await sessionProofKey(window.location.origin);
    const second = await sessionProofKey(window.location.origin);
    expect(second).toBe(first);
    expect(second.thumbprint).toBe(first.thumbprint);
    expect(first.privateKey.extractable).toBe(false);
    expect(first.persistent).toBe(false);
  });
});
