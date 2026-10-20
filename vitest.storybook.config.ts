import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import type { ToMatchScreenshotOptions } from 'vitest/node';
import { defineConfig } from 'vitest/config';

const screenshots = process.env.AUTHOWL_SCREENSHOTS === '1';
const updating = process.argv.some((arg) => arg === '-u' || arg === '--update' || arg.startsWith('--update='));
if (screenshots && updating && (process.platform !== 'linux' || process.env.AUTHOWL_SCREENSHOT_UPDATE !== '1')) {
  throw new Error('Generate pixel baselines only with pnpm screenshots:update (pinned Linux Chromium).');
}

const dirname = path.dirname(fileURLToPath(import.meta.url));

function storybookProject(locale: 'en' | 'ar', theme: 'light' | 'dark') {
  const projectName = `storybook-${locale}-${theme}`;
  return {
    extends: true as const,
    cacheDir: path.join(dirname, 'node_modules', '.vite', projectName),
    define: {
      'import.meta.env.AUTHOWL_SCREENSHOT_THRESHOLD': JSON.stringify(process.env.AUTHOWL_SCREENSHOT_THRESHOLD ?? '0.06'),
      'import.meta.env.AUTHOWL_SCREENSHOTS': JSON.stringify(process.env.AUTHOWL_SCREENSHOTS ?? '0'),
      'import.meta.env.AUTHOWL_STORY_LOCALE': JSON.stringify(locale),
      'import.meta.env.AUTHOWL_STORY_THEME': JSON.stringify(theme),
    },
    optimizeDeps: {
      include: ['react/jsx-dev-runtime'],
    },
    plugins: [
      storybookTest({
        configDir: path.join(dirname, '.storybook'),
      }),
    ],
    test: {
      name: projectName,
      browser: {
        enabled: true,
        headless: true,
        viewport: { width: 1280, height: 900 },
        expect: {
          toMatchScreenshot: {
            // Keep each locale/theme independent in Vitest's default layout.
            resolveScreenshotPath: ({ root, testFileDirectory, testFileName, arg, ext }) =>
              path.join(root, testFileDirectory, '__screenshots__', testFileName, projectName, `${arg}${ext}`),
          } satisfies ToMatchScreenshotOptions,
        },
        provider: playwright({
          contextOptions: { timezoneId: 'UTC', locale: 'en-US', deviceScaleFactor: 1 },
          launchOptions: {
            channel: 'chromium',
          },
        }),
        instances: [{ browser: 'chromium' as const }],
      },
    },
  };
}

export default defineConfig({
  test: {
    // A local comparison must fail on missing baselines instead of authoring them.
    ...(screenshots ? { update: 'none' as const } : {}),
    projects: [
      storybookProject('en', 'light'),
      storybookProject('en', 'dark'),
      storybookProject('ar', 'light'),
      storybookProject('ar', 'dark'),
    ],
  },
});
