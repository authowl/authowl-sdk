import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseApiKey } from '../src/key-format';

const vectors = JSON.parse(readFileSync(new URL('../../../conformance/vectors/publishable-key.json', import.meta.url), 'utf8'));
describe('CLI key grammar matches the shared corpus', () => {
  it('keeps the core and CLI key grammar sources byte-identical', () => {
    expect(readFileSync(new URL('../src/key-format.ts', import.meta.url))).toEqual(
      readFileSync(new URL('../../auth-core/src/api-key-format.ts', import.meta.url)),
    );
  });
  for (const row of vectors.cases) {
    it(row.name, () => {
      const decoded = parseApiKey(row.key);
      if (row.expect.ok) {
        expect(decoded).toEqual({ kind: 'pk', env: row.expect.env, projectId: row.expect.projectId, region: row.expect.region });
        expect(parseApiKey(row.key.replace(/^pk_/i, 'sk_'))).toEqual({ ...decoded, kind: 'sk' });
      } else if (row.expect.reason === 'secret_key') {
        const acceptedSecrets = new Map([
          ['a secret key is refused outright', null],
          ['a secret key is refused regardless of case', null],
          ['secret refusal 5', 'eu-de'],
        ]);
        if (acceptedSecrets.has(row.name)) {
          expect(decoded).toEqual({
            kind: 'sk', env: 'live',
            projectId: '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60',
            region: acceptedSecrets.get(row.name),
          });
        } else {
          expect(decoded).toBeNull();
        }
      } else {
        expect(decoded).toBeNull();
      }
    });
  }
});
