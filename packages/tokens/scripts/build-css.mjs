// Writes the CSS outputs from the built module, so the CSS and the typed
// export can never disagree: both come from src/tokens.ts.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shadcnCss, themeCss, tokensCss } from '../dist/index.js';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
for (const [file, css] of [['tokens.css', tokensCss()], ['theme.css', themeCss()], ['shadcn.css', shadcnCss()]]) {
  writeFileSync(resolve(dist, file), css);
}
