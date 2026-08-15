import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConvexHttpClient } from 'convex/browser';
import { createAuthOwlClient, resolveConfig } from '../../../packages/auth-core/dist/index.js';
import { api } from '../convex/_generated/api.js';

const configPath = process.env.AUTHOWL_CONVEX_ACCEPTANCE_CONFIG;
if (!configPath) throw new Error('AUTHOWL_CONVEX_ACCEPTANCE_CONFIG is required.');
const config = acceptanceConfig(
  JSON.parse(await readFile(configPath, 'utf8')),
  process.env.CONVEX_URL ?? 'http://127.0.0.1:3210',
  process.env.AUTHOWL_ISSUER_URL,
);
const origin = 'http://localhost:5174';
const cookies = new Map();
let namedTokenRequests = 0;

const authowl = createAuthOwlClient(resolveConfig({
  publishableKey: config.publishableKey,
  apiUrl: config.apiUrl,
  fetch: async (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    if (cookies.size > 0) {
      headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    if (new URL(String(input)).pathname.endsWith('/token/convex')) namedTokenRequests += 1;
    const response = await fetch(input, { ...init, headers });
    rememberCookies(response, cookies);
    return response;
  },
}));

let session = await authowl.signUp.email({
  email: config.email,
  password: config.password,
  name: 'Convex Acceptance User',
});
const existingAccountCodes = new Set([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
]);
if (session.error && existingAccountCodes.has(session.error.code)) {
  session = await authowl.signIn.email({ email: config.email, password: config.password });
}
assert.equal(session.error, null, session.error?.message);
assert.ok(session.data?.token, 'AuthOwl did not establish an acceptance session.');
const userId = session.data.user.id;

const first = await authowl.getToken({ template: 'convex' });
const cached = await authowl.getToken({ template: 'convex' });
const forced = await authowl.getToken({ template: 'convex', forceRefresh: true });
assert.ok(first, 'AuthOwl did not mint the first Convex token.');
assert.equal(cached, first, 'A warm Convex template cache unexpectedly re-minted.');
assert.ok(forced, 'AuthOwl did not mint the forced Convex token.');
assert.notEqual(forced, first, 'Force refresh returned the cached Convex token.');
assert.equal(namedTokenRequests, 2, 'Convex cache or force-refresh request count drifted.');
assertTokenContract(first, config, userId);
assertTokenContract(forced, config, userId);

const convex = new ConvexHttpClient(config.convexUrl);
convex.setAuth(first);
const firstIdentity = await convex.query(api.me.me, {});
convex.setAuth(forced);
const forcedIdentity = await convex.query(api.me.me, {});
const expectedIdentity = {
  userId,
  email: config.email,
  name: 'Convex Acceptance User',
};
assert.deepEqual(firstIdentity, expectedIdentity);
assert.deepEqual(forcedIdentity, expectedIdentity);

console.info('Real local Convex acceptance passed: identity verified and force refresh re-minted.');
if (process.env.AUTHOWL_CONVEX_TYPELESS_TOKEN_FILE) {
  await probeTypEnforcement(
    process.env.AUTHOWL_CONVEX_TYPELESS_TOKEN_FILE,
    config.convexUrl,
  );
}

async function probeTypEnforcement(tokenPath, convexUrl) {
  const token = (await readFile(tokenPath, 'utf8')).trim();
  const [headerPart] = token.split('.');
  assert.ok(headerPart, 'Typeless probe token is malformed.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
  assert.equal(header.typ, undefined, 'Typeless probe unexpectedly contains typ.');

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  let identity;
  try {
    identity = await client.query(api.me.me, {});
  } catch (cause) {
    if (cause instanceof TypeError) throw cause;
    console.info('Convex observation: a valid custom JWT without typ is rejected.');
    return;
  }
  assert.equal(identity?.email, 'typeless-probe@test.local');
  console.info('Convex observation: a valid custom JWT without typ is accepted.');
}

function rememberCookies(response, jar) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const setCookie of setCookies) {
    const pair = setCookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(setCookie)) jar.delete(name);
    else jar.set(name, value);
  }
}

function assertTokenContract(token, config, userId) {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  assert.ok(headerPart && payloadPart && signaturePart, 'AuthOwl returned a malformed JWT.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'ES256');
  assert.equal(header.typ, 'JWT');
  assert.equal(typeof header.kid, 'string');
  assert.equal(payload.iss, config.issuer);
  assert.equal(payload.aud, config.projectId);
  assert.equal(payload.sub, userId);
}

function acceptanceConfig(value, convexUrl, issuer) {
  if (!isRecord(value)) throw new TypeError('Acceptance config must be an object.');
  for (const key of ['apiUrl', 'publishableKey', 'email', 'password', 'projectId']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new TypeError(`Acceptance config ${key} is required.`);
    }
  }
  const parsedConvexUrl = new URL(convexUrl);
  if (!['http:', 'https:'].includes(parsedConvexUrl.protocol) ||
      parsedConvexUrl.pathname !== '/' || parsedConvexUrl.search || parsedConvexUrl.hash) {
    throw new TypeError('CONVEX_URL must be an HTTP(S) deployment origin.');
  }
  const parsedIssuer = new URL(issuer);
  if (!['http:', 'https:'].includes(parsedIssuer.protocol) || !parsedIssuer.pathname.endsWith('/auth')) {
    throw new TypeError('AUTHOWL_ISSUER_URL must be an AuthOwl issuer URL.');
  }
  return {
    apiUrl: value.apiUrl,
    publishableKey: value.publishableKey,
    email: value.email,
    password: value.password,
    projectId: value.projectId,
    convexUrl: parsedConvexUrl.origin,
    issuer: parsedIssuer.toString().replace(/\/$/, ''),
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
