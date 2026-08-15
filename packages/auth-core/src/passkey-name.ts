import type { AuthActionResult } from './client';

export const MAX_PASSKEY_NAME_LENGTH = 256;
const FORBIDDEN_BIDI = new Set([
  0x061c,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
]);
const BOUNDARY_WHITESPACE = new Set([
  0x0009,
  0x000a,
  0x000b,
  0x000c,
  0x000d,
  0x0020,
  0x0085,
  0x00a0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
]);

export type ValidatedPasskeyName =
  | { valid: true; value: string | undefined }
  | { valid: false };

export function validatePasskeyName(
  value: string | undefined,
): ValidatedPasskeyName {
  if (value === undefined) return { valid: true, value: undefined };
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined
      || isLoneSurrogate(character, codePoint)
      || isControl(codePoint)
      || FORBIDDEN_BIDI.has(codePoint)
    ) {
      return { valid: false };
    }
  }
  const normalized = trimBoundaryWhitespace(value);
  if (!isCanonicalPasskeyName(normalized)) return { valid: false };
  return { valid: true, value: normalized };
}

export function isCanonicalPasskeyName(value: string): boolean {
  let codePoints = 0;
  let firstCodePoint: number | undefined;
  let lastCodePoint: number | undefined;
  for (const character of value) {
    codePoints += 1;
    if (codePoints > MAX_PASSKEY_NAME_LENGTH) return false;
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined
      || isLoneSurrogate(character, codePoint)
      || isControl(codePoint)
      || FORBIDDEN_BIDI.has(codePoint)
    ) {
      return false;
    }
    firstCodePoint ??= codePoint;
    lastCodePoint = codePoint;
  }
  return (
    codePoints > 0
    && firstCodePoint !== undefined
    && lastCodePoint !== undefined
    && !BOUNDARY_WHITESPACE.has(firstCodePoint)
    && !BOUNDARY_WHITESPACE.has(lastCodePoint)
  );
}

export function invalidPasskeyName<T>(): AuthActionResult<T> {
  return {
    data: null,
    error: {
      status: 400,
      statusText: 'BAD_REQUEST',
      code: 'INVALID_PASSKEY_NAME',
      message:
        'Passkey names must contain 1 to 256 safe Unicode characters.',
    },
  };
}

function trimBoundaryWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const codePoint = value.codePointAt(start);
    if (codePoint === undefined || !BOUNDARY_WHITESPACE.has(codePoint)) break;
    start += codePoint > 0xffff ? 2 : 1;
  }
  while (end > start) {
    const trailing = value.codePointAt(end - 1);
    if (trailing === undefined) break;
    const lowSurrogate = trailing >= 0xdc00 && trailing <= 0xdfff;
    const index = lowSurrogate ? end - 2 : end - 1;
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined || !BOUNDARY_WHITESPACE.has(codePoint)) break;
    end = index;
  }
  return value.slice(start, end);
}

function isControl(codePoint: number): boolean {
  return (
    (codePoint >= 0x0000 && codePoint <= 0x001f)
    || (codePoint >= 0x007f && codePoint <= 0x009f)
  );
}

function isLoneSurrogate(character: string, codePoint: number): boolean {
  return (
    character.length === 1
    && codePoint >= 0xd800
    && codePoint <= 0xdfff
  );
}
