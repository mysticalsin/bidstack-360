# Learnings Encyclopedia — BidStack 360° Swarm

> Append-only. Every cycle must produce at least one learning. Stagnation is failure.

---

## Cycle #0 — Initialization (2026-05-22)

### Successes

- **S-0.1** Monorepo structure is sound: pnpm workspaces, clear app/package boundaries, no circular dependencies detected.
- **S-0.2** Security posture is strong after audit: org-scoped queries, Zod validation, HMAC webhooks, SSRF defense.
- **S-0.3** Design system foundation exists: 8px grid, 9-step type scale, dark/light mode, WCAG 2.2 AA baseline.
- **S-0.4** All 21 pages render without critical errors per QA audit (2026-05-23).

### Failures

- **F-0.1** Test coverage is critically low. Vitest + Playwright infrastructure exists but actual test files are sparse. This is the #1 risk to code quality score.
- **F-0.2** No Lighthouse performance baseline captured. We are flying blind on LCP, INP, CLS.
- **F-0.3** Mobile responsive is completely untested. QA audit marked it "not tested" across all 21 pages.
- **F-0.4** Command palette (Ctrl+K) did not trigger in QA audit. Core UX feature is non-functional.
- **F-0.5** Framer Motion console warnings on Pipeline page (`"transparent" is not an animatable value`). Signals sloppy animation targets.
- **F-0.6** Intermittent 500 on `/api/v1/crm/dashboard?account={id}`. Root cause unknown. Reliability red flag.
- **F-0.7** No edge caching, no read replicas, no CDN asset delivery. Infrastructure is single-node.
- **F-0.8** Accessibility gaps: keyboard kanban drag/drop TBD, no screen-reader testing on Opportunity 360°.

### Hypotheses

- **H-0.1** If we add comprehensive Playwright e2e tests for all 21 pages first, we catch regressions before they compound. This unlocks confident refactoring.
- **H-0.2** Fixing the Framer Motion transparent animation bug is a 1-line change with high signal-to-noise ratio for design score.
- **H-0.3** The intermittent 500 on CRM dashboard is likely a missing `try/catch` around a Prisma query or an unhandled null in a computed field.

### Decisions

- **D-0.1** First experiment (Cycle #1) will target **Code Quality** dimension — add unit tests for shared Zod schemas and core API route utilities. Lowest-hanging fruit with highest compounding value.
- **D-0.2** No new features until composite score > 70. Only score-improving experiments allowed.
