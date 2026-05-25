# Code Standards & Compliance Audit

## Summary
- ESLint disable lines: 16
- Default exports in packages: 1 (`packages/odoo-mcp-client/vitest.config.ts` — config file, acceptable)
- Deep relative imports: 0
- TODO/FIXME comments: 0
- MISTAKES.md repeats found: Repeated mojibake patch attempt, Repeated PowerShell chaining, Repeated Bash-style command chaining, Repeated wildcard positional test search, Repeated quoted regex search, Repeated complex rg pattern, Repeated PowerShell wildcard path, Repeated broad patching, Repeated stale shared dist validation, Repeated Prisma generate while API locked
- Top risk: `@typescript-eslint/no-unsafe-*` rules are fully disabled project-wide, stripping type-safety guardrails for assignments, member access, arguments, returns, and calls.

## Findings

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| HIGH | `eslint.config.js` | 42–46 | `@typescript-eslint/no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-argument`, `no-unsafe-return`, and `no-unsafe-call` are all set to `off` globally. | Replace blanket `off` with targeted `eslint-disable-next-line` blocks that include a WHY comment, or scope the override to the specific files that interact with `any`-shaped Pino/Fastify plugins. |
| MEDIUM | `apps/api/src/routes/sales-orders.ts` | 386 | `eslint-disable-next-line @typescript-eslint/no-explicit-any` without a WHY comment. | Add a one-line `// WHY: …` justification per the eslint.config.js hard-floor rule before suppressing the error. |
| MEDIUM | `apps/api/src/storage/index.ts` | 197 | `eslint-disable-next-line @typescript-eslint/no-explicit-any -- WHY: see above` is vague; “see above” does not explain the specific justification for this line. | Replace with an explicit, line-specific WHY comment describing why `any` is unavoidable at this exact call site. |
| MEDIUM | `apps/web/src/lib/auth.tsx` | 199, 205, 211, 217, 223 | Six consecutive `eslint-disable-next-line react-refresh/only-export-components` suppressions in a library file. | Move non-component exports (hooks/utilities) to a separate `auth.utils.ts` file so the React component file exports only components, eliminating all six disables. |
| LOW | `apps/web/src/components/motion/AnimatedNumber.tsx` | 59 | `eslint-disable-next-line react-hooks/exhaustive-deps` with no WHY comment. | Document why the missing dependency is intentional, or add the missing dependency and remove the disable. |
| LOW | `apps/web/src/components/opportunity/BriefingDialog.tsx` | 29 | `eslint-disable-next-line react-hooks/exhaustive-deps` with no WHY comment. | Document why the missing dependency is intentional, or add the missing dependency and remove the disable. |
| LOW | `apps/web/src/pages/BidNoBidPage.tsx` | 179 | Block-style `/* eslint-disable react-hooks/set-state-in-effect */` suppresses the rule for the remainder of the file. | Convert to a single-line `eslint-disable-next-line` with a WHY comment, or refactor the state mutation out of the effect. |
| LOW | `apps/web/src/lib/web-vitals.ts` | 171 | `eslint-disable-next-line no-console` in shipped source; the surrounding comment labels it a “Dev-mode console logger” but it is not environment-gated. | Guard the logger with `if (process.env.NODE_ENV !== 'production')` or remove it and rely on the existing Pino logger. |
| INFO | `MISTAKES.md` | Multiple | 10+ entries start with “Repeated …”, indicating logged prevention rules are being ignored (mojibake patching, PowerShell chaining, regex searches, stale dist validation, Prisma generate while API locked). | Enforce a brief pre-task checklist: read last 3 relevant MISTAKES.md entries before acting on tooling or patch operations. |
| INFO | `docs/solutions/` | N/A | 22 compound-engineering knowledge files exist, but zero inline code references found (`grep -rn "docs/solutions" apps/ packages/` returned nothing). | Add JSDoc `@see docs/solutions/<file>.md` links above complex or reused patterns so developers discover the knowledge base during implementation. |
