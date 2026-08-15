/**
 * Decode and validate a publishable key. Throws if the key is malformed or has
 * the secret prefix (we refuse to accept secret keys on the client side).
 *
 * Accepts: pk_live_<uuid>_<base62>  or  pk_test_<uuid>_<base62>
 */
const PK_RE = /^(pk_(live|test))_([0-9a-f-]{36})_([A-Za-z0-9]{20,})$/i;
const SK_RE = /^sk_/i;

export type DecodedPublishableKey = {
  prefix: 'pk_live' | 'pk_test';
  env: 'live' | 'test';
  projectId: string;
};

export function decodePublishableKey(key: string): DecodedPublishableKey {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('publishableKey is required');
  }
  if (SK_RE.test(key)) {
    throw new Error(
      'A secret key was passed where a publishable key was expected. Never embed secret keys in client code.',
    );
  }
  const m = PK_RE.exec(key);
  if (!m) {
    throw new Error('publishableKey is malformed; expected pk_(live|test)_<uuid>_<base62>');
  }
  // ALL THREE ARE LOWERCASED BECAUSE `PK_RE` CARRIES `/i`. It accepts a
  // case-mangled key, so returning the captured text verbatim hands the rest of
  // the SDK values that only LOOK like the declared types:
  //
  //  - `projectId` is compared byte-for-byte against server-supplied values that
  //    are always the lowercase Postgres `uuid` - `environmentId` and `jwt.aud`
  //    in `public-config.ts`, the JWT `aud`/`iss` in `server.ts`. Mixed case
  //    turns a valid config into `INVALID_PUBLIC_CONFIG` and a valid token into a
  //    verification failure.
  //  - `env` is read as `env === 'test'` to allow http loopback; a `pk_TEST_…`
  //    key yielding `'TEST'` silently refuses a developer's own localhost.
  //
  // The other five SDKs already lowercase prefix and env; this one is the mirror
  // that did not. Lowercasing here is belt-and-braces for the cookie name -
  // `sessionCookieName` canonicalises independently, because two callers reach a
  // project id without passing through this function at all.
  return {
    prefix: m[1]!.toLowerCase() as DecodedPublishableKey['prefix'],
    env: m[2]!.toLowerCase() as DecodedPublishableKey['env'],
    projectId: m[3]!.toLowerCase(),
  };
}
