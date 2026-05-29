// Flat config for the BidStack monorepo.
// Per-workspace overrides live below the base config so a single root lint
// command covers every package.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const noConsoleExceptError = {
  // CLAUDE.md hard floor #5: no console.log in shipped code.
  // We allow console.error (used by the MCP stdio servers and Pino fallback).
  'no-console': ['error', { allow: ['error', 'warn'] }],
};

const noAnyWithoutWhy = {
  // CLAUDE.md hard floor #6: no `any` unless a one-line WHY comment justifies
  // it. The TS rule errors on `any`; we tell devs to disable per-line with a
  // comment when justified.
  '@typescript-eslint/no-explicit-any': 'error',
};

const baseTsRules = {
  ...noConsoleExceptError,
  ...noAnyWithoutWhy,
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  // no-floating-promises and await-thenable need type-aware linting (a
  // parserOptions.projectService graph). Re-enable in a follow-up sprint
  // once we wire one tsconfig per workspace into typescript-eslint.
  // Pino logger and many Fastify plugins return `any`-shaped values; we don't
  // want this rule firing every time we serialize an audit payload.
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  // Use type-only imports to keep the runtime graph small; warn so devs
  // notice but don't block the build.
  '@typescript-eslint/consistent-type-imports': [
    'warn',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
  ],
};

export default tseslint.config(
  // 1. Global ignores (must be its own object — no `files` key).
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/twenty-bidstack/**', // preserved verbatim per architecture
      'packages/db/prisma/migrations/**',
      'packages/db/generated/**', // Prisma client codegen
      '**/generated/**', // any future codegen
      '**/.vite/**',
      '**/dist/**',
      '**/build/**',
      'apps/web/dist/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
      'apps/web/scratch-*.js',
      'handoff/**',
      '.tmp/**', // extracted prototype zips kept for cross-referencing only
      '.audit-screens/**',
      '.codex/**',
      '.claude/worktrees/**', // ephemeral agent worktrees, not source
    ],
  },

  // 2. Base JS recommendations.
  js.configs.recommended,

  // 3. TypeScript recommendations (type-checked variant for app code only).
  ...tseslint.configs.recommended,

  // 4. Project-wide TS rules.
  {
    files: ['**/*.{ts,tsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: baseTsRules,
  },

  // 5. Web-specific (React + browser globals).
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 18 + Vite JSX runtime
      'react/prop-types': 'off', // we use TS
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // 6. Design-system primitives (apps/web/src/components/ui/*) are
  // intentional re-export modules that wrap Radix. Fast Refresh's
  // "pure component file" rule doesn't fit and isn't actionable here.
  {
    files: ['apps/web/src/components/ui/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // 6b. Marketing site (apps/marketing) — same React + browser config as
  // apps/web. Separate workspace so it can deploy to bidstack.dev independently.
  {
    files: ['apps/marketing/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // 7. Test files: relax a couple rules.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'apps/web/e2e/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
    },
  },

  // 7. Build / config / scripts can use console freely.
  {
    files: [
      '*.config.{js,ts,mjs,cjs}',
      '**/vite.config.ts',
      '**/vitest.config.ts',
      '**/playwright.config.ts',
      'apps/marketing/scripts/**/*.mjs',
      'packages/db/src/seed.ts',
      'packages/db/src/seed.rbac.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  // 8. Disable rules Prettier handles.
  prettier,
);
