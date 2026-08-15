import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // React Native itself cannot be loaded here - it ships untranspiled
      // Flow-typed source. Components still import from 'react-native' (correct
      // for consumers); tests render against a small DOM stand-in instead.
      'react-native': fileURLToPath(new URL('./test/react-native-stub.tsx', import.meta.url)),
    },
  },
});
