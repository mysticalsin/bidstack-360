# CLAUDE.md

This file governs Claude's behavior in the **BidStack 360°** repository. Two sections: **Conduct** (universal) and **Architecture** (project-specific).

Conduct rules apply unless explicitly overridden. Explicit override = the user names the rule number or quotes the rule. Casual disagreement is not override.

---

# PART 1 — CONDUCT (universal)

Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## Tony's /goal execution standard

For non-trivial work, never take the easy or sloppy route. Think, plan, execute,
and verify. Define assumptions and success criteria before implementation, use
the right expert lenses for the work, keep changes surgical, and stop only when
the goal is verified or the next step needs Tony's product/security guidance.

## Rule 1 — Think Before Coding

State assumptions explicitly. If uncertain, ask rather than guess. Present multiple interpretations when ambiguity exists. Push back when a simpler approach exists. Stop when confused. Name what's unclear.

## Rule 2 — Simplicity First

Minimum code that solves the problem. Nothing speculative. No features beyond what was asked. No abstractions for single-use code. Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes

Touch only what you must. Clean up only your own mess. Don't "improve" adjacent code, comments, or formatting. Don't refactor what isn't broken. Match existing style.

## Rule 4 — Goal-Driven Execution

Define success criteria. Loop until verified. Don't follow steps. Define success and iterate. Strong success criteria let you loop independently.
**Tiebreaker with Rule 1:** Ask when criteria are unclear; loop when defined and verifiable.

## Rule 5 — Use the model only for judgment calls

When implementing systems that call an LLM, only route judgment-shaped work to the model: classification, drafting, summarization, extraction. Deterministic transforms, routing, retries, and parsing belong in code. If code can answer, code answers.

## Rule 6 — Token budgets are not advisory

Per-task: 15,000 tokens. Per-session: 100,000 tokens. (Raised from defaults — this is a large monorepo.) If approaching budget, summarize and start fresh. Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them

If two patterns contradict, pick one (more recent / more tested). Explain why. Flag the other for cleanup. Don't blend conflicting patterns.

## Rule 8 — Read before you write

Before adding code, read exports, immediate callers, shared utilities. "Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Rule 9 — Tests verify intent, not just behavior

Tests must encode WHY behavior matters, not just WHAT it does. A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step

Summarize what was done, what's verified, what's left. Don't continue from a state you can't describe back. If you lose track, stop and restate.

Format:

```
✅ Done:      <what's verified>
🔄 Now:       <what's running>
⏭️  Next:      <what's queued>
⚠️  Surfaced:  <conflicts, deferred work, or "none">
```

## Rule 11 — Match the codebase's conventions, even if you disagree

Conformance > taste inside the codebase. If you genuinely think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud

"Completed" is wrong if anything was skipped silently. "Tests pass" is wrong if any were skipped. Default to surfacing uncertainty, not hiding it.

## Rule 13 — Confirm before destructive operations

Force-push, `rm -rf` on anything not in `/tmp`, dropping tables, deleting branches, rewriting history, truncating data, and any operation that loses work require explicit confirmation. No exceptions for "I'm sure."

## Rule 14 — Never commit secrets

No keys, tokens, passwords, or `.env` contents in commits, logs, or output. If you see one already committed, flag it loudly. Don't print secrets when echoing config.

---

# PART 2 — ARCHITECTURE (project-specific)

## Stack

- **Runtime:** Node.js 24 LTS
- **Package manager:** pnpm 10 (workspaces)
- **Frontend:** React 18 + Vite 6 + TypeScript 5.7 + Tailwind CSS 4 + Radix UI primitives
- **Backend:** Fastify 5 + Zod 3 + Pino + Prisma 5
- **Database:** PostgreSQL 16
- **Queue:** BullMQ + Redis 7
- **Auth:** Clerk (production) / dev stub (local)
- **MCP SDK:** `@modelcontextprotocol/sdk` ^1.0.0
- **Test runner:** Vitest 2
- **E2E:** Playwright

## Layout

```
BIDCRM/
├── apps/
│   ├── web/              # React + Vite frontend (port of the prototype)
│   ├── api/              # Fastify REST API
│   ├── worker/           # BullMQ workers (Dust poll, enrichment)
│   └── mcp-server/       # @modelcontextprotocol/sdk
├── packages/
│   ├── db/               # Prisma schema + client
│   ├── dust-client/      # Typed Dust workspace API wrapper
│   ├── shared/           # Zod schemas, shared types
│   └── twenty-bidstack/  # Twenty overlay (preserved from handoff zip)
├── docs/                 # Design docs, ADRs, solutions
├── .claude/              # Hooks, agents, project rules
├── CLAUDE.md             # this file
├── SPEC.md               # canonical product spec
├── PROGRESS.md           # sprint log
├── MISTAKES.md           # repeated-mistake ledger
└── pnpm-workspace.yaml
```

## Conventions

- **File naming:** kebab-case for files, PascalCase for React components, camelCase for utilities
- **Imports:** absolute via `@bidstack/<package>` workspace aliases; never `../../..`
- **No default exports** in libraries; named exports only. Default export OK for React pages/route components.
- **Errors:** typed Result objects in libs; throw in route handlers (Fastify catches and serializes)
- **State (frontend):** Zustand for global UI state; React Query (`@tanstack/react-query`) for server state. No Redux.
- **Logging:** Pino with request-scoped child loggers. No `console.log` in shipped code.
- **CSS:** Tailwind utility-first. CSS variables for theme tokens (light/dark). No styled-components.
- **Dates:** ISO 8601 strings on the wire. `date-fns` for client formatting.
- **Money:** Always store amounts in **micros** (integer × 1e6) per Twenty/Stripe convention. Format at the edge.

## Commands

| Concern        | Command                                 |
| -------------- | --------------------------------------- |
| Install        | `pnpm install`                          |
| Dev (all)      | `pnpm dev`                              |
| Dev (web only) | `pnpm dev:web`                          |
| Dev (api only) | `pnpm dev:api`                          |
| DB migrate     | `pnpm db:migrate`                       |
| DB seed        | `pnpm db:seed`                          |
| DB reset       | `pnpm db:reset` (destructive — confirm) |
| Lint           | `pnpm lint`                             |
| Typecheck      | `pnpm typecheck`                        |
| Test           | `pnpm test`                             |
| Test (watch)   | `pnpm test:watch`                       |
| E2E            | `pnpm e2e`                              |
| Build          | `pnpm build`                            |

## What NOT to touch without permission

- `packages/twenty-bidstack/` — preserved verbatim from handoff zip; modifying it breaks the future Twenty migration path
- `prisma/migrations/` — generated by Prisma; never hand-edit
- `.env*` (anything but `.env.example`) — secrets
- `.github/workflows/` — CI; coordinate before edits

## Token budget overrides

Per-task: 15,000. Per-session: 100,000. (Defaults raised from 4K/30K — this is a >25 file monorepo.)

## Architectural decisions

- `docs/ARCHITECTURE.md` — authoritative architecture overview
- `docs/DUST.md` — Dust integration patterns (cross-references `handoff/dust.integration.md`)
- `docs/MCP.md` — MCP server design (cross-references `handoff/mcp.tools.md`)
- `docs/solutions/` — compound-engineering knowledge entries (per Tony's architect-protocol)

## Quality gates

Per Tony's `architect-protocol.md`:

- Score every release on the 100-point rubric (Functional 25 / Code 25 / Design 25 / Infra 25)
- Ship at ≥ 95/100
- Update MISTAKES.md immediately on every error; never repeat a logged mistake
- Search `docs/solutions/` before every implementation (compound engineering)

## Design system

Per Tony's `design-standards.md` and the Apple HIG referenced in the handoff:

- Apple HIG component principles
- 8px spatial grid; 9-step type scale
- Dark mode is mandatory, not optional
- Every interactive component ships **all states**: default / hover / focus (2px ring, 3:1 contrast) / active / loading / error / empty / disabled / success
- WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text, 44×44px touch targets, full keyboard nav, `prefers-reduced-motion` respected
- Performance: LCP < 2.5s, INP < 200ms, CLS < 0.1
- Images: WebP/AVIF, lazy loading, responsive `srcset`
