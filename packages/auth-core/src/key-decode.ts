import { parseApiKey } from './api-key-format';

/**
 * Decode and validate a publishable key. Throws if the key is malformed or has
 * the secret prefix (we refuse to accept secret keys on the client side).
 *
 * Accepts pk_(live|test)_[<region>_]<uuid>_<base62>. Region is a hint only.
 */
const SK_RE = /^sk_/i;

export type DecodedPublishableKey = {
  prefix: 'pk_live' | 'pk_test';
  env: 'live' | 'test';
  projectId: string;
  region: string | null;
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
  const m = parseApiKey(key);
  if (!m || m.kind !== 'pk') {
    throw new Error('publishableKey is malformed; expected pk_(live|test)_[<region>_]<uuid>_<base62>');
  }
  return {
    prefix: `pk_${m.env}`,
    env: m.env,
    projectId: m.projectId,
    region: m.region,
  };
}
