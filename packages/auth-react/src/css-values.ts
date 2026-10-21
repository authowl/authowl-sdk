import { parseColor } from './brand';

const warned = new Set<string>();
/** Shared by SSR and client renders. Never rely on a browser CSS parser. */
export function safeCssValue(name: string, value: string, kind: 'color' | 'length' | 'font'): boolean {
  const safe = typeof value === 'string' && value.trim().length > 0 &&
    !/[;{}<>\\\r\n\f\v\u0085\u2028\u2029]/.test(value) && !/\/\*|!\s*important|(?:url|expression|var|env|attr)\s*\(/i.test(value);
  const valid = safe && (kind === 'color' ? parseColor(value) !== null : kind === 'length' ? isLength(value.trim()) :
    /^(?:[\w -]+|"[\w -]+"|'[\w -]+')(?:\s*,\s*(?:[\w -]+|"[\w -]+"|'[\w -]+'))*$/.test(value));
  if (!valid && process.env.NODE_ENV !== 'production' && !warned.has(name)) {
    warned.add(name);
    console.warn(`[AuthOwl] Ignoring invalid appearance value for ${name}.`);
  }
  return valid;
}

const LENGTH = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cm|mm|q|in|pt|pc|%))$/i;
function isLength(value: string): boolean {
  if (LENGTH.test(value)) return true;
  // A deliberately small calc grammar: sums/differences of lengths, with no
  // identifiers, substitutions, multiplication, or trailing CSS tokens.
  if (!/^calc\(.+\)$/i.test(value)) return false;
  const terms = value.slice(5, -1).trim().split(/\s+[+-]\s+/);
  return terms.length > 0 && terms.every(term => term !== '0' && LENGTH.test(term));
}
