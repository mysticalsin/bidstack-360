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
import designLaw from './packages/eslint-rules/design-law.js';

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
      '.qa-artifacts/**', // QA swarm scripts/output — workflow-runtime globals, not product code
      '.codex/**',
      '.claude/worktrees/**', // ephemeral agent worktrees, not source
      'BIDCRM-design/**', // nested sibling project — not part of this repo
      'scratch_skills/**', // exploratory scratch directory
      'scratch_img/**', // exploratory scratch directory
      '.corepack/**', // vendored pnpm runtime, not source
      '.planning/**',
      'apps/chrome-extension/**', // vanilla JS Chrome extension — not part of TS monorepo
      'apps/mobile/**', // React Native — has its own Babel/Metro config
      'apps/docs/**', // Docusaurus / static docs site
      'integrations/**', // Zapier app and other CJS/vanilla-JS integrations
      'load-tests/**', // k6 load-test scripts — not Node.js, use k6 globals
      'scripts/**', // one-off ops scripts — console is intentional there
      'apps/web/scripts/**', // one-off i18n/QA harnesses with agent globals
      'scratch/**', // local scratch scripts (gitignored)
      'apps/*/_*.mjs', // local workspace probes (gitignored)
      '.claire/**', // ephemeral agent worktrees
      '.clone/**', // ephemeral agent worktrees
      '.swarm_state/**', // agent swarm output directory
      '.tmp-screens/**', // playwright screenshot dumps
      '.vercel/**', // Vercel CLI build output — bundled artifacts, not source
      '.lighthouserc.js', // Lighthouse CI config
      'tmp-*.cjs', // root-level temp migration scripts
      'tmp-*.js', // root-level temp scripts
      '*.mjs', // root-level scratch/audit scripts (axe-login-audit, etc.)
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

  // 6a. Design law (docs/adr/0002-design-tokens.md + fusion-validation
  // Amendments 4/6). Scoped to apps/web/src only so other workspaces'
  // `pnpm lint` is untouched. Rules live in packages/eslint-rules/ — flat
  // config loads local rule files as inline plugin objects, no package
  // publish needed. Escape hatch: an eslint-disable for these rules must
  // cite an ADR in the comment (risk register #6).
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'bidstack-design': designLaw,
    },
    rules: {
      'bidstack-design/no-theme-variant-geometry': 'error',
      'bidstack-design/no-foreign-token-vocabulary': 'error',
      'bidstack-design/no-arbitrary-geometry': 'error',
      // warn (not error): pre-existing hex debt in login Hero/DemoSignIn and
      // TerritoryPanels — upgrade once those migrate to tokens.
      'bidstack-design/no-raw-hex-in-classname': 'warn',
    },
  },

  // 6a-bis. Legacy literal-geometry debt, quarantined so no-arbitrary-geometry
  // can land at 'error' for everything new (the table-kit graft included)
  // without turning the green baseline red. Measured, not guessed: 89
  // arbitrary-geometry class sites exist in apps/web/src, 74 of which already
  // reference a token and are legal. These 9 files hold the remaining 15
  // literals — decorative login/hero chrome (rounded-[28px], rounded-[2rem],
  // bespoke drop shadows) plus three off-scale spacing values. Same precedent
  // as no-raw-hex-in-classname above: quarantine the debt, don't weaken the
  // law. Delete an entry as its file migrates to the scale; delete the block
  // when the list empties.
  {
    files: [
      'apps/web/src/components/charts/ChartContainer.tsx', // -m-[8px] p-[8px]
      'apps/web/src/components/layout/CurrencySelector.tsx', // inset highlight shadow
      'apps/web/src/components/login/BottomLeftCard.tsx', // rounded-[1.2/1.5/2.2rem]
      'apps/web/src/components/login/BottomRightCorner.tsx', // rounded-tl-[1.5/2/3.5rem]
      'apps/web/src/components/login/DemoSignIn.tsx', // shadow-[0_8px_40px_rgba(…)]
      'apps/web/src/components/login/Hero.tsx', // rounded-[2rem] + literal shadow
      'apps/web/src/components/rfp/shared/PipelineProgress.tsx', // mt-[-14px]
      'apps/web/src/pages/audit-log/AuditLogHero.tsx', // rounded-[28px]
      'apps/web/src/pages/integrations/IntegrationHero.tsx', // rounded-[28px]
    ],
    rules: {
      'bidstack-design/no-arbitrary-geometry': 'warn',
    },
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
      'packages/db/src/seed-demo.ts',
      'packages/db/src/seed-prod.ts',
      'packages/db/scripts/purge-demo-data.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  // 8. Disable rules Prettier handles.
  prettier,
);
