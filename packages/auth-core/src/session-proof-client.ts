import type { SessionStart, SessionTokenStore } from './session-token';

const PROOF_TYP = 'pop+jwt';
const PROOF_ALG = 'ES256';
const DB_NAME = 'authowl-session-proof';
const STORE_NAME = 'origin-keys';
const DB_VERSION = 1;
const BINDING_NONCE_BYTES = 32;
const JTI_BYTES = 16;
const CAPABILITY_MAX_BODY_BYTES = 128;
const CAPABILITY_TIMEOUT_MS = 10_000;
const ABANDON_TIMEOUT_MS = 2_000;

type PublicProofJwk = JsonWebKey & {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
};

export type SessionProofKey = Readonly<{
  privateKey: CryptoKey;
  publicJwk: PublicProofJwk;
  thumbprint: string;
  /** False when IndexedDB is unavailable, so the token must not outlive this tab. */
  persistent: boolean;
}>;

type StoredProofKey = {
  origin: string;
  privateKey: CryptoKey;
  publicJwk: PublicProofJwk;
  thumbprint: string;
};

const memoryKeys = new Map<string, Promise<SessionProofKey>>();

export async function boundedSessionFetch(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('AuthOwl session transport request timed out.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function cookieCapability(
  fetcher: typeof fetch,
  url: string,
  headers: Headers,
): Promise<boolean | 'legacy'> {
  const started = await boundedSessionFetch(fetcher, url, {
    method: 'POST',
    credentials: 'include',
    headers,
  }, CAPABILITY_TIMEOUT_MS);
  if (started.status === 404 || started.status === 405) return 'legacy';
  if (started.status !== 204) throw new Error('AuthOwl cookie capability check failed.');

  const completed = await boundedSessionFetch(fetcher, url, {
    method: 'GET',
    credentials: 'include',
    headers,
  }, CAPABILITY_TIMEOUT_MS);
  if (completed.status === 404 || completed.status === 405) return 'legacy';
  if (completed.status !== 200) throw new Error('AuthOwl cookie capability check failed.');
  const body = await completed.text();
  if (new TextEncoder().encode(body).byteLength > CAPABILITY_MAX_BODY_BYTES) {
    throw new Error('AuthOwl cookie capability response is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('AuthOwl cookie capability response is invalid.');
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || Object.keys(parsed).length !== 1
    || typeof (parsed as { cookieSupported?: unknown }).cookieSupported !== 'boolean'
  ) {
    throw new Error('AuthOwl cookie capability response is invalid.');
  }
  return (parsed as { cookieSupported: boolean }).cookieSupported;
}

export async function abandonSession(
  fetcher: typeof fetch,
  url: string,
  headers: Headers,
  authorization: string,
): Promise<void> {
  const abandonment = new Headers(headers);
  abandonment.set('authorization', authorization);
  abandonment.set('x-authowl-session-transport', 'bearer');
  try {
    await boundedSessionFetch(fetcher, url, {
      method: 'POST',
      credentials: 'include',
      headers: abandonment,
    }, ABANDON_TIMEOUT_MS);
  } catch {
    // Local authority is still dropped by the caller. Recovery must never keep
    // a credential merely because its best-effort server revocation failed.
  }
}

export async function prepareSenderConstrainedSession(input: {
  tokens: SessionTokenStore;
  start: SessionStart;
  clientOrigin: string | null;
  fetcher: typeof fetch;
  projectBaseURL: string;
  headers: Headers;
}): Promise<{ binding: { key: SessionProofKey; nonce: string } | null; cookieOnly: boolean }> {
  const { tokens } = input;
  tokens.beginSession(input.start);
  if (!input.clientOrigin) return { binding: null, cookieOnly: false };

  let currentKey: SessionProofKey | null = null;
  if (tokens.hasToken()) {
    const expected = tokens.bindingThumbprint();
    if (expected) {
      try {
        const resolvedKey = await sessionProofKey(input.clientOrigin);
        if (resolvedKey.thumbprint !== expected) throw new Error('Session proof key changed.');
        currentKey = resolvedKey;
      } catch {
        const headers = new Headers();
        tokens.declareOn(headers);
        const authorization = headers.get('authorization');
        if (authorization) {
          await abandonSession(
            input.fetcher,
            `${input.projectBaseURL}/session/abandon`,
            input.headers,
            authorization,
          );
        }
        tokens.endSession();
        tokens.beginSession(input.start);
      }
    }
  }

  let capability: boolean | 'legacy';
  try {
    capability = await cookieCapability(
      input.fetcher,
      `${input.projectBaseURL}/session/cookie-capability`,
      input.headers,
    );
  } catch {
    // A broken or intercepted response must fail closed, never to an unbound bearer.
    tokens.useCookieTransport();
    return { binding: null, cookieOnly: false };
  }
  if (capability === 'legacy') return { binding: null, cookieOnly: false };
  if (capability) {
    if (tokens.hasToken()) return { binding: null, cookieOnly: true };
    tokens.useCookieTransport();
    return { binding: null, cookieOnly: false };
  }
  const key = currentKey ?? await sessionProofKey(input.clientOrigin);
  tokens.useBoundBearerTransport(key.thumbprint, key.persistent);
  return { binding: { key, nonce: bindingNonce() }, cookieOnly: false };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value))));
}

function isPublicProofJwk(value: JsonWebKey): value is PublicProofJwk {
  return value.kty === 'EC'
    && value.crv === 'P-256'
    && typeof value.x === 'string'
    && value.x.length > 0
    && typeof value.y === 'string'
    && value.y.length > 0
    && value.d === undefined;
}

async function thumbprint(jwk: PublicProofJwk): Promise<string> {
  return sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}

function validPrivateKey(key: unknown): key is CryptoKey {
  if (!key || typeof key !== 'object') return false;
  const candidate = key as CryptoKey;
  const algorithm = candidate.algorithm as EcKeyAlgorithm;
  return candidate.type === 'private'
    && candidate.extractable === false
    && candidate.usages.length === 1
    && candidate.usages[0] === 'sign'
    && algorithm.name === 'ECDSA'
    && algorithm.namedCurve === 'P-256';
}

/** Internal test seam for simulating a document reload after key storage loss. */
export function clearSessionProofKeyMemoryForTests(): void {
  memoryKeys.clear();
}

async function validateStored(value: unknown): Promise<SessionProofKey | null> {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredProofKey>;
  if (!validPrivateKey(record.privateKey) || !record.publicJwk || !isPublicProofJwk(record.publicJwk)) {
    return null;
  }
  const calculated = await thumbprint(record.publicJwk);
  if (record.thumbprint !== calculated) return null;
  return {
    privateKey: record.privateKey,
    publicJwk: record.publicJwk,
    thumbprint: calculated,
    persistent: true,
  };
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'origin' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readStored(origin: string): Promise<SessionProofKey | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const value = await new Promise<unknown>((resolve) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(origin);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return await validateStored(value);
  } finally {
    db.close();
  }
}

async function writeStored(
  origin: string,
  key: SessionProofKey,
): Promise<'stored' | 'conflict' | 'unavailable'> {
  const db = await openDatabase();
  if (!db) return 'unavailable';
  try {
    return await new Promise<'stored' | 'conflict' | 'unavailable'>((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).add({
          origin,
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          thumbprint: key.thumbprint,
        } satisfies StoredProofKey);
      } catch {
        resolve('unavailable');
        return;
      }
      transaction.oncomplete = () => resolve('stored');
      transaction.onerror = () => {
        const error = transaction.error;
        resolve(error?.name === 'ConstraintError' ? 'conflict' : 'unavailable');
      };
      transaction.onabort = () => {
        const error = transaction.error;
        resolve(error?.name === 'ConstraintError' ? 'conflict' : 'unavailable');
      };
    });
  } finally {
    db.close();
  }
}

async function generateProofKey(): Promise<SessionProofKey> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (!isPublicProofJwk(exported)) throw new Error('The browser produced an invalid proof key.');
  return {
    privateKey: pair.privateKey,
    publicJwk: exported,
    thumbprint: await thumbprint(exported),
    persistent: false,
  };
}

/** One non-extractable P-256 key per tenant application origin. */
export function sessionProofKey(origin: string): Promise<SessionProofKey> {
  const existing = memoryKeys.get(origin);
  if (existing) return existing;
  const pending = (async () => {
    const stored = await readStored(origin);
    if (stored) return stored;
    const created = await generateProofKey();
    const written = await writeStored(origin, created);
    if (written === 'stored') return { ...created, persistent: true };
    if (written === 'conflict') return await readStored(origin) ?? created;
    return created;
  })();
  memoryKeys.set(origin, pending);
  void pending.catch(() => memoryKeys.delete(origin));
  return pending;
}

export function bindingNonce(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(BINDING_NONCE_BYTES)));
}

function normalizedUri(value: string): string {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Create a fresh compact ES256 proof bound to a nonce or session token. */
export async function createSessionProof(input: {
  key: SessionProofKey;
  method: string;
  url: string;
  token: string;
}): Promise<string> {
  const header = base64Url(utf8(JSON.stringify({
    typ: PROOF_TYP,
    alg: PROOF_ALG,
    jwk: input.key.publicJwk,
  })));
  const payload = base64Url(utf8(JSON.stringify({
    htm: input.method.toUpperCase(),
    htu: normalizedUri(input.url),
    iat: Math.floor(Date.now() / 1_000),
    jti: base64Url(crypto.getRandomValues(new Uint8Array(JTI_BYTES))),
    ath: await sha256(input.token),
  })));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    input.key.privateKey,
    utf8(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export async function createStoredSessionProof(input: {
  origin: string;
  expectedThumbprint: string;
  method: string;
  url: string;
  token: string;
}): Promise<string> {
  const key = await sessionProofKey(input.origin);
  if (key.thumbprint !== input.expectedThumbprint) throw new Error('Session proof key changed.');
  return createSessionProof({ key, method: input.method, url: input.url, token: input.token });
}
