import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react-base.tsx',
    'react-commerce': 'src/react.tsx',
    server: 'src/server.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: [
    '@authowl/core',
    '@authowl/core/server',
    '@authowl/react',
    '@authowl/next/server',
    'react',
    'react/jsx-runtime',
  ],
});
