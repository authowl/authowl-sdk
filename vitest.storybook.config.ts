import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

function storybookProject(locale: 'en' | 'ar', theme: 'light' | 'dark') {
  const projectName = `storybook-${locale}-${theme}`;
  return {
    extends: true as const,
    cacheDir: path.join(dirname, 'node_modules', '.vite', projectName),
    define: {
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
        provider: playwright({
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
    projects: [
      storybookProject('en', 'light'),
      storybookProject('en', 'dark'),
      storybookProject('ar', 'light'),
      storybookProject('ar', 'dark'),
    ],
  },
});
