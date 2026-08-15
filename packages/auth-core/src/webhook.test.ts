import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook } from './webhook';

const SECRET = 'whsec_test_vector';
const PREVIOUS_SECRET = 'whsec_previous_test_vector';
const TIMESTAMP = '1700000000';
const BODY = '{"id":"evt_1","type":"user.created"}';

function signature(secret: string, body = BODY, timestamp = TIMESTAMP): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

describe('verifyWebhook', () => {
  it('verifies exact bytes and accepts either active rotation secret', async () => {
    await expect(verifyWebhook({
      rawBody: new TextEncoder().encode(BODY),
      timestamp: TIMESTAMP,
      signatureHeader: `v1=${'0'.repeat(64)},${signature(PREVIOUS_SECRET)}`,
      secrets: [SECRET, PREVIOUS_SECRET],
      now: Number(TIMESTAMP),
    })).resolves.toBe(true);
  });

  it.each([
    ['changed body', { rawBody: `${BODY} ` }],
    ['expired timestamp', { now: Number(TIMESTAMP) + 301 }],
    ['future timestamp', { now: Number(TIMESTAMP) - 301 }],
    ['non-canonical timestamp', { timestamp: `0${TIMESTAMP}` }],
    ['malformed signature', { signatureHeader: 'v1=xyz' }],
    ['too many signatures', {
      signatureHeader: Array.from({ length: 5 }, () => signature(SECRET)).join(','),
    }],
  ])('fails closed for %s', async (_name, override) => {
    await expect(verifyWebhook({
      rawBody: BODY,
      timestamp: TIMESTAMP,
      signatureHeader: signature(SECRET),
      secrets: [SECRET],
      now: Number(TIMESTAMP),
      ...override,
    })).resolves.toBe(false);
  });

  it('rejects an oversized body before cryptographic work', async () => {
    await expect(verifyWebhook({
      rawBody: new Uint8Array(1024 * 1024 + 1),
      timestamp: TIMESTAMP,
      signatureHeader: signature(SECRET),
      secrets: [SECRET],
      now: Number(TIMESTAMP),
    })).resolves.toBe(false);
  });

  it.each([
    ['empty secret set', []],
    ['too many secrets', [SECRET, PREVIOUS_SECRET, 'whsec_third_test_vector']],
    ['invalid secret', ['secret_without_prefix']],
    ['duplicate secrets', [SECRET, SECRET]],
  ])('throws loudly for %s', async (_name, secrets) => {
    await expect(verifyWebhook({
      rawBody: BODY,
      timestamp: TIMESTAMP,
      signatureHeader: signature(SECRET),
      secrets,
      now: Number(TIMESTAMP),
    })).rejects.toThrow(TypeError);
  });
});
