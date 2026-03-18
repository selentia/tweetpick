import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const PROJECT_IGNORES = ['dist/**', 'release/**', 'node_modules/**', '.cache/**', 'coverage/**', 'package-lock.json'];

const COMMON_TS_RULES = {
  eqeqeq: 'off',
  'prefer-const': 'off',
  'no-duplicate-imports': 'off',
  'no-console': 'off',
  'no-useless-assignment': 'off',
  'preserve-caught-error': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
};

export default [
  {
    ignores: PROJECT_IGNORES,
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/rt-draw/**/*.ts', 'src/preload/**/*.ts', 'src/types/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      ...COMMON_TS_RULES,
    },
  },
  {
    files: ['src/renderer/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    rules: {
      ...COMMON_TS_RULES,
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
];
