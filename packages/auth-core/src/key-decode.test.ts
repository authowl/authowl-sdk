import { describe, expect, it } from 'vitest';
import { decodePublishableKey } from './key-decode';

/**
 * THE PART OF THE DECODER THE SHARED CORPUS CANNOT OWN.
 *
 * `conformance/vectors/publishable-key.json` pins the project id's case in all
 * six SDKs, and that is where the id rule lives - do not copy it here. The
 * PREFIX's case cannot go in the corpus, because the six grammars disagree by
 * design: only this one carries `/i` (`PK_RE`, key-decode.ts), so `pk_TEST_…` is
 * a VALID key here and `malformed` in Go, Python, PHP, Dart and Rust. A vector
 * asserting either answer would fail five SDKs or this one.
 *
 * So it is pinned locally, and it is not cosmetic: `env` is read as
 * `env === 'test'` to decide `allowHttpLoopback` (config.ts), so a `pk_TEST_…`
 * key decoding to `'TEST'` silently refused a developer's own localhost. And
 * `prefix`/`env` are CAST to their literal union types on the way out, so
 * returning the captured text verbatim made the declared type a lie that `tsc`
 * could not see.
 *
 * The uuid here is deliberately already lowercase: the only variable under test
 * is the prefix.
 */

const PROJECT_ID = '2f1c9a84-6b3d-4e57-9a10-5c8d7e2b4f60';
const SUFFIX = 'A1b2C3d4E5f6G7h8I9j0';

describe('decodePublishableKey prefix and env case', () => {
  it.each([
    ['pk_TEST', `pk_TEST_${PROJECT_ID}_${SUFFIX}`, 'pk_test', 'test'],
    ['pk_LIVE', `pk_LIVE_${PROJECT_ID}_${SUFFIX}`, 'pk_live', 'live'],
    ['PK_Live', `PK_Live_${PROJECT_ID}_${SUFFIX}`, 'pk_live', 'live'],
  ])('canonicalises a %s key', (_label, key, prefix, env) => {
    expect(decodePublishableKey(key)).toEqual({ prefix, env, projectId: PROJECT_ID });
  });

  it('reports the same env for a key that differs only in prefix case', () => {
    // The consequence, stated as an invariant rather than a string: everything
    // downstream branches on `env === 'test'`, never on the raw text.
    expect(decodePublishableKey(`pk_TEST_${PROJECT_ID}_${SUFFIX}`).env).toBe(
      decodePublishableKey(`pk_test_${PROJECT_ID}_${SUFFIX}`).env,
    );
  });
});
