import { defineConfig } from 'tsup';

// The AuthOwl client is first-party. Its reviewed WebAuthn ceremony helper is
// bundled so framework-neutral consumers install only @authowl/core.
export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts', 'src/native.ts', 'src/messages.ts', 'src/privacy.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  // Minify published bytes and omit sourcemaps.
  minify: true,
  treeshake: true,
  noExternal: [/^@simplewebauthn\/browser(\/.*)?$/],
});
