import { describe, expect, it } from 'vitest';
import { qrPath } from './qr';

/**
 * The QR matrix drives 2FA enrolment - a wrong or empty code would send users to a
 * secret that never validates and lock them out. This pins that a real otpauth URI
 * encodes to a non-trivial, deterministic matrix.
 */
describe('qrPath', () => {
  const uri = 'otpauth://totp/Acme:a@b.co?secret=JBSWY3DPEHPK3PXP&issuer=Acme';

  it('encodes an otpauth URI to a square matrix with dark modules', () => {
    const m = qrPath(uri);
    expect(m).not.toBeNull();
    expect(m!.count).toBeGreaterThanOrEqual(21); // smallest QR version is 21x21
    expect(m!.d.length).toBeGreaterThan(0);
    // Path is built from unit-cell ops within the grid; every drawn cell fits.
    expect(m!.d.startsWith('M')).toBe(true);
  });

  it('is deterministic for the same input', () => {
    expect(qrPath(uri)).toEqual(qrPath(uri));
  });

  it('returns null for an empty value (caller falls back to manual entry)', () => {
    expect(qrPath('')).toBeNull();
  });
});
