import { describe, expect, it } from 'vitest';
import { PRIVACY_RIGHT_TYPES, offeredRightTypes } from './privacy-client';

describe('offeredRightTypes', () => {
  it('offers everything when the server cannot report availability', () => {
    // The compatibility rule the whole feature rests on. Reading `undefined` as
    // "none" would blank the privacy tab of every app on an older deployment.
    expect(offeredRightTypes(undefined)).toEqual([...PRIVACY_RIGHT_TYPES]);
  });

  it('offers nothing when the project accepts none', () => {
    // Different from undefined, and the state that produced the live report:
    // an unapproved compliance profile refuses every right.
    expect(offeredRightTypes([])).toEqual([]);
  });

  it('offers exactly what is advertised, in the canonical order', () => {
    expect(offeredRightTypes(['portability', 'access'])).toEqual(['access', 'portability']);
  });

  it('ignores a right this build has no button for', () => {
    // The server's set can grow. An unknown entry must not crash a published
    // SDK, and must not smuggle a right this build cannot render.
    expect(offeredRightTypes(['access', 'telepathy'])).toEqual(['access']);
  });

  it('is unmoved by duplicates', () => {
    expect(offeredRightTypes(['access', 'access'])).toEqual(['access']);
  });
});
