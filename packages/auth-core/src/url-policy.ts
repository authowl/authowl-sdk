type AuthUrlValidationOptions = {
  label: 'apiUrl' | 'issuer' | 'jwksUri';
  allowHttpLoopback: boolean;
};

const HTTP_LOOPBACK_RE =
  /^http:\/\/(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

function fail(label: AuthUrlValidationOptions['label'], reason: string): never {
  throw new Error(`${label}: ${reason}`);
}

function rawPathname(value: string): string {
  const match = /^https?:\/\/[^/?#]*(\/[^?#]*)?$/i.exec(value);
  return match?.[1] ?? '';
}

function validateAuthUrl(
  value: unknown,
  { label, allowHttpLoopback }: AuthUrlValidationOptions,
): URL {
  if (typeof value !== 'string' || value.length === 0) {
    fail(label, 'required');
  }
  if (value !== value.trim()) {
    fail(label, 'surrounding whitespace');
  }
  if (value.includes('?') || value.includes('#')) {
    fail(label, 'query or fragment forbidden');
  }
  if (value.includes('\\') || /%[0-9a-f]{2}/i.test(value)) {
    fail(label, 'path must be unencoded');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(label, 'absolute URL required');
  }

  if (url.username || url.password) {
    fail(label, 'credentials forbidden');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail(label, 'HTTPS required');
  }
  if (
    url.protocol === 'http:'
    && (!allowHttpLoopback || !HTTP_LOOPBACK_RE.test(value))
  ) {
    fail(label, 'HTTPS required except exact loopback');
  }
  return url;
}

/**
 * Validate a concrete SDK request URL without changing its path or query.
 *
 * Endpoint-specific path policy stays with the caller. This function owns the
 * shared network invariant only: absolute HTTPS, with HTTP allowed solely for
 * an explicitly approved exact loopback development target.
 */
export function canonicalTransportUrl(
  value: string | URL,
  options: { allowHttpLoopback: boolean },
): URL {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new TypeError('Transport URL must be absolute.');
  }
  if (url.username || url.password || url.hash) {
    throw new TypeError('Transport URL must not contain credentials or a fragment.');
  }
  const serialized = url.toString();
  if (
    url.protocol !== 'https:'
    && !(
      url.protocol === 'http:'
      && options.allowHttpLoopback
      && HTTP_LOOPBACK_RE.test(serialized)
    )
  ) {
    throw new TypeError('Transport URL must use HTTPS except on approved loopback.');
  }
  return url;
}

function assertCanonicalPath(
  value: string,
  url: URL,
  label: 'issuer' | 'jwksUri',
): void {
  const rawPath = rawPathname(value);
  if (
    rawPath.includes('//')
    || rawPath.split('/').some((segment) => segment === '.' || segment === '..')
    || (rawPath !== '' && rawPath !== url.pathname)
  ) {
    fail(label, 'path traversal or duplicate separator');
  }
}

export function canonicalApiOrigin(
  value: unknown,
  options: { allowHttpLoopback: boolean },
): string {
  if (
    typeof value !== 'string'
    || !/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(value)
  ) {
    fail('apiUrl', 'origin required');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('apiUrl', 'origin required');
  }
  if (
    url.protocol === 'http:'
    && (!options.allowHttpLoopback || !HTTP_LOOPBACK_RE.test(value))
  ) {
    fail('apiUrl', 'HTTPS required except exact loopback');
  }
  return url.origin;
}

export function canonicalVerifierUrls(
  issuerValue: unknown,
  jwksUriValue: unknown,
  options: { allowHttpLoopback: boolean } = { allowHttpLoopback: false },
): { issuer: string; jwksUri: string } {
  const issuer = validateAuthUrl(issuerValue, {
    label: 'issuer',
    allowHttpLoopback: options.allowHttpLoopback,
  });
  const jwksUri = validateAuthUrl(jwksUriValue, {
    label: 'jwksUri',
    allowHttpLoopback: options.allowHttpLoopback,
  });
  assertCanonicalPath(issuerValue as string, issuer, 'issuer');
  assertCanonicalPath(jwksUriValue as string, jwksUri, 'jwksUri');

  if (issuer.pathname !== '/' && issuer.pathname.endsWith('/')) {
    fail('issuer', 'trailing slash forbidden');
  }
  return {
    issuer: issuer.toString().replace(/\/$/, ''),
    jwksUri: jwksUri.toString(),
  };
}
