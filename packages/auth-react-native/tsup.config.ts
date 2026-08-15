import { defineConfig } from 'tsup';

// `react` and `react-native` are peer dependencies the host app already ships,
// and `react-native` is not installed in this monorepo at all. Declared here
// rather than as repeated `--external` CLI flags, which tsup does not reliably
// accumulate.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['react', 'react-native'],
});
