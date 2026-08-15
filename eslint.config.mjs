import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typedFiles = [
  '.storybook/**/*.{ts,tsx}',
  'examples/**/*.{ts,tsx}',
  'packages/**/*.{ts,tsx}',
  'scripts/**/*.ts',
  'stories/**/*.{ts,tsx}',
  '*.ts',
];
const sourceFiles = ['**/*.{js,cjs,mjs,ts,tsx}'];
const SECURITY_RULES = {
  'security/detect-bidi-characters': 'error',
  'security/detect-child-process': 'error',
  'security/detect-eval-with-expression': 'error',
  'security/detect-new-buffer': 'error',
  'security/detect-non-literal-regexp': 'error',
  'security/detect-non-literal-require': 'error',
  'security/detect-no-csrf-before-method-override': 'error',
  'security/detect-pseudoRandomBytes': 'error',
};

function forTypedFiles(configs) {
  return configs.map((config) => ({
    ...config,
    files: typedFiles,
  }));
}

export default tseslint.config(
  {
    ignores: [
      // Local agent worktrees: a nested checkout of this whole repo, which
      // eslint otherwise walks and reports thousands of parse errors in - enough
      // to make `pnpm lint` useless and to hide a real finding in the noise.
      // Ignored here as well as in .gitignore because eslint does not read that.
      '**/.claude/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      '**/coverage/**',
      '.venv-authowl/**',
      'sdks/php/vendor/**',
      'sdks/python/.venv/**',
      'sdks/rust/target/**',
      'sdks/flutter/.dart_tool/**',
      'examples/convex/convex/_generated/**',
      'packages/auth-core/src/admin-api.generated.ts',
      'packages/auth-core/src/admin-operations.generated.ts',
      'packages/cli/test/fixtures/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  eslint.configs.recommended,
  ...forTypedFiles(tseslint.configs.recommended),
  {
    files: typedFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-control-regex': 'off',
    },
  },
  {
    files: typedFiles,
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: sourceFiles,
    plugins: {
      security,
    },
    rules: SECURITY_RULES,
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
