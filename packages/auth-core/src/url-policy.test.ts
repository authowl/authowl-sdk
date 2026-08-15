import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config';
import { canonicalVerifierUrls } from './url-policy';

const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const TEST_KEY = `pk_test_${PROJECT_ID}_abcdefghij0123456789`;
const LIVE_KEY = `pk_live_${PROJECT_ID}_abcdefghij0123456789`;

describe('canonical AuthOwl URL policy', () => {
  it.each([
    'http://localhost:3010',
    'http://tenant.localhost:3010',
    'http://127.0.0.1:3010',
    'http://[::1]:3010',
  ])('allows exact loopback HTTP with a test publishable key: %s', (apiUrl) => {
    expect(resolveConfig({ publishableKey: TEST_KEY, apiUrl }).apiUrl).toBe(apiUrl);
  });

  it('allows loopback for a case-mangled test key too', () => {
    // `PK_RE` carries `/i`, so `pk_TEST_…` is a VALID key. This allowance is
    // gated on `decoded.env === 'test'`, which was false while the decoder
    // returned the captured text verbatim - refusing a developer's own
    // localhost on a key the same decoder had just accepted.
    const mangled = `pk_TEST_${PROJECT_ID}_abcdefghij0123456789`;
    expect(resolveConfig({ publishableKey: mangled, apiUrl: 'http://localhost:3010' }).apiUrl).toBe(
      'http://localhost:3010',
    );
  });

  it.each([
    'http://127.0.0.2:3010',
    'http://127.1:3010',
    'http://2130706433:3010',
    'http://0x7f000001:3010',
    'http://localhost.example.com:3010',
    'http://example.com:3010',
  ])('rejects non-exact HTTP loopback forms: %s', (apiUrl) => {
    expect(() => resolveConfig({ publishableKey: TEST_KEY, apiUrl })).toThrow(/HTTPS/i);
  });

  it('does not allow a live key to turn loopback into an HTTP production escape hatch', () => {
    expect(() =>
      resolveConfig({ publishableKey: LIVE_KEY, apiUrl: 'http://localhost:3010' }),
    ).toThrow(/HTTPS/i);
  });

  it.each([
    'https://user:pass@auth.example.com',
    'https://auth.example.com?target=elsewhere',
    'https://auth.example.com#fragment',
    'https://auth.example.com/api',
    ' https://auth.example.com',
    'https://auth.example.com ',
    'https://auth.example.com/%2e%2e',
    'https://auth.example.com/api/../',
    'https://auth.example.com//',
    'ftp://auth.example.com',
  ])('rejects a non-canonical API origin: %s', (apiUrl) => {
    expect(() => resolveConfig({ publishableKey: TEST_KEY, apiUrl })).toThrow();
  });

  it('normalizes an accepted API origin before deriving the project route', () => {
    const config = resolveConfig({
      publishableKey: TEST_KEY,
      apiUrl: 'https://AUTH.EXAMPLE.COM:443/',
    });
    expect(config.apiUrl).toBe('https://auth.example.com');
    expect(config.projectBaseURL).toBe(
      `https://auth.example.com/api/projects/${PROJECT_ID}/auth`,
    );
  });

  it('preserves independent canonical URLs for a fully custom deployment', () => {
    expect(
      canonicalVerifierUrls(
        'https://issuer.example.com/custom/issuer',
        'https://keys.example.net/v1/signing-keys',
      ),
    ).toEqual({
      issuer: 'https://issuer.example.com/custom/issuer',
      jwksUri: 'https://keys.example.net/v1/signing-keys',
    });
  });

  it('rejects explicit HTTP verifier URLs without a test-key-bound derived config', () => {
    expect(() =>
      canonicalVerifierUrls(
        'http://[::1]:3010/custom/issuer',
        'http://[::1]:3010/custom/issuer/jwks',
      ),
    ).toThrow(/HTTPS/i);
  });
});
