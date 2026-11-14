import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // Grade package source, never stale dist. Specific subpaths come first
      // because a plain core key would also rewrite core/i18n to a missing path.
      {
        find: /^@authowl\/core\/i18n$/,
        replacement: fileURLToPath(
          new URL('../auth-core/src/messages.ts', import.meta.url),
        ),
      },
      {
        find: /^@authowl\/core\/privacy$/,
        replacement: fileURLToPath(
          new URL('../auth-core/src/privacy.ts', import.meta.url),
        ),
      },
      {
        find: /^@authowl\/core\/server$/,
        replacement: fileURLToPath(
          new URL('../auth-core/src/server.ts', import.meta.url),
        ),
      },
      {
        find: /^@authowl\/next\/server$/,
        replacement: fileURLToPath(
          new URL('../auth-next/src/server.ts', import.meta.url),
        ),
      },
      {
        find: /^@authowl\/core$/,
        replacement: fileURLToPath(
          new URL('../auth-core/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@authowl\/react$/,
        replacement: fileURLToPath(
          new URL('../auth-react/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
});
