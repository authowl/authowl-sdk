import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @authowl/core to its SOURCE, not its dist. The repo's `test`
      // script does not build first, so without this the suite silently grades
      // whatever dist happened to be lying around: a fix to
      // `sessionCookieName` would go on "failing" until someone rebuilt core,
      // and - far worse - a regression would go on PASSING against a stale
      // build that still had the old behaviour compiled in.
      '@authowl/core/server': fileURLToPath(
        new URL('../auth-core/src/server.ts', import.meta.url),
      ),
      '@authowl/core': fileURLToPath(
        new URL('../auth-core/src/index.ts', import.meta.url),
      ),
    },
  },
});
