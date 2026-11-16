import { copyFileSync } from 'node:fs';

copyFileSync(
  new URL('../src/styles.css', import.meta.url),
  new URL('../dist/styles.css', import.meta.url),
);
