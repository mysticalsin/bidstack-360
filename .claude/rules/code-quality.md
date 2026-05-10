---
description: Always-apply baseline for BidStack 360°
alwaysApply: true
---

# Code quality baseline (always applies)

This is the minimal floor for every file in this repo. CLAUDE.md has the full 14 rules; this is the always-on subset that's auto-loaded into every session.

## Hard floor

1. **No secrets in commits, logs, output.** `.env`, `*.pem`, `*.key`, tokens, API keys.
2. **No force push** without explicit per-operation consent.
3. **No `rm -rf` outside `/tmp`** without explicit confirmation.
4. **Tests must encode WHY.** A test that can't fail when business logic changes is wrong.
5. **No `console.log` in shipped code.** Use Pino (backend) or a debug helper (frontend).
6. **No `any` in TypeScript** unless prefixed with a `// eslint-disable-next-line` and a one-line WHY comment.
7. **Org-scope every query.** Multi-tenancy is non-negotiable. Every Prisma query that touches a tenant table MUST include `where: { orgId }`.
8. **44×44px minimum touch targets** on every interactive element.
9. **Dark mode is mandatory.** Every component supports both modes via CSS variables.
10. **WCAG 2.2 AA contrast.** 4.5:1 normal text, 3:1 large text + UI.

## Naming

- Files: `kebab-case.ts` (utilities), `PascalCase.tsx` (React components)
- Functions: `camelCase`
- Types/Interfaces/Enums: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- React hooks: `useCamelCase`
- Zustand stores: `useFooStore`

## Imports

- Absolute via `@bidstack/<package>` aliases
- Never `../../..`
- Side-effect imports first, then external packages, then internal, then relative

## Files

- Max function length: 50 lines (refactor if longer)
- Max file length: 400 lines (split if longer)
- Comments explain **WHY**, not WHAT — well-named code already says what
- No commented-out code in PRs
