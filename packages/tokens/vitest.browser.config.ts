import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// The cascade can only be proven by a browser: which brand and scheme a
// nested element resolves, and where next/font's variable reaches.
export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: 'chromium' } }),
      instances: [{ browser: 'chromium' }],
      // The assertions read computed values; a screenshot adds nothing and
      // would be written into the source tree.
      screenshotFailures: false,
    },
  },
});
