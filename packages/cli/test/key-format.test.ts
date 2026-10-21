import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseApiKey } from '../src/key-format';

const vectors = JSON.parse(readFileSync(new URL('../../../conformance/vectors/publishable-key.json', import.meta.url), 'utf8'));
describe('CLI key grammar matches the shared corpus', () => {
  for (const row of vectors.cases) {
    it(row.name, () => {
      const decoded = parseApiKey(row.key);
      if (row.expect.ok) {
        expect(decoded).toEqual({ kind: 'pk', env: row.expect.env, projectId: row.expect.projectId, region: row.expect.region });
        expect(parseApiKey(row.key.replace(/^pk_/, 'sk_'))).toEqual({ ...decoded, kind: 'sk' });
      } else if (row.expect.reason !== 'secret_key') {
        expect(decoded).toBeNull();
      }
    });
  }
});
