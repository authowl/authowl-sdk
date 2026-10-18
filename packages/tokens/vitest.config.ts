import { configDefaults, defineConfig } from 'vitest/config';

// The browser test runs on its own, in Chromium: `pnpm run test:browser`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'src/**/*.browser.test.ts'],
  },
});
