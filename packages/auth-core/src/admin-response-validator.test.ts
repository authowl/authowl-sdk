import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchesKnownPattern } from './admin-response-validator';

const samples = new Map([
  ['^[a-z0-9_-]{1,128}$', 'billing_feature-1'],
  ['^[a-z0-9]+(?:-[a-z0-9]+)*$', 'billing-feature'],
  ['^[a-z][a-z0-9_-]*$', 'billing_feature-1'],
  ['^[A-Za-z0-9][A-Za-z0-9._:/-]*$', 'Billing.Feature:1/path'],
  ['^[a-z][a-z0-9_]{0,63}$', 'billing_feature'],
  ['^[A-Za-z][A-Za-z0-9_]{0,63}$', 'Billing_Feature'],
]);

describe('Admin response schema patterns', () => {
  it('implements every pattern allowed by the generator', () => {
    const generator = readFileSync(
      fileURLToPath(new URL('../../../scripts/generate-admin-api.mjs', import.meta.url)),
      'utf8',
    );
    const allowlist = /const RESPONSE_SCHEMA_PATTERNS = new Set\(\[([\s\S]*?)\]\);/
      .exec(generator)?.[1];
    expect(allowlist).toBeDefined();
    const patterns = [...allowlist!.matchAll(/^ {2}'([^']+)',$/gm)]
      .map((match) => match[1]!);
    expect(patterns.sort()).toEqual([...samples.keys()].sort());
    for (const pattern of patterns) {
      expect(matchesKnownPattern(samples.get(pattern)!, pattern), pattern).toBe(true);
    }
  });
});
