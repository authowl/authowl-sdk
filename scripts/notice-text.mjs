// Remove nested delimited metadata in one linear pass. Package metadata is
// untrusted input, so repeated regular-expression replacement is not sufficient:
// a crafted nested value can otherwise leave a new HTML opener behind.
export function stripDelimitedSections(value, open, close) {
  const output = [];
  let depth = 0;
  for (const character of value) {
    if (character === open) {
      depth += 1;
      continue;
    }
    if (character === close && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0) output.push(character);
  }
  return output.join('');
}
