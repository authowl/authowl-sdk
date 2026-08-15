import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  minify: true,
  splitting: false,
  platform: 'node',
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
