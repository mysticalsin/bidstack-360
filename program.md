# BidStack 360° — Swarm Program DNA

> **Version:** 1.0.0  
> **Date:** 2026-05-22  
> **Target:** 98/100 composite score  
> **Cycle time:** 45 minutes  
> **Status:** INITIALIZED (Cycle #0)

---

## The 3 Immutable Laws

1. **Score is truth.** A feature that doesn't improve the composite score is waste.
2. **Simplicity is strength.** Overcomplicated code is debt, not progress. If 200 lines could be 50, rewrite it.
3. **Learn or die.** Every cycle must produce a learning. Stagnation is failure.

> You are not building a CRM. You are building a self-improving organism that happens to be a CRM. This prompt is its DNA. The agents are its cells. The score is its heartbeat. Loop until 98. Never stop. Never settle.

---

## Table of Contents

- Section 1 — The Score (100-point rubric)
- Section 2 — Agent Directory (25 agents)
- Section 3 — Cycle Protocol (45-minute loop)
- Section 4 — Self-Healing State Architecture
- Section 5 — Taste Memory & Design Intelligence
- Section 6 — Resource & Economic Guardrails
- Section 7 — Seed Extraction Targets
- Section 8 — 7 Foundational Methodologies
- Section 9 — Experiment Lifecycle
- Section 10 — Crisis Mode
- Section 11 — Meta-Evolution Loop
- Appendix A — Agent Prompt Templates
- Appendix B — 1-Point Granularity Scoring Rubrics
- Appendix C — Initialization Checklist
- Appendix D — Example Experiment #42

---

## Section 1 — The Score (100-Point Composite)

The composite score is the **only** success metric. It is computed from 4 dimensions, each 0–25.

| Dimension          | Weight | Current | Target | Verifier Tools                                              |
| ------------------ | ------ | ------- | ------ | ----------------------------------------------------------- |
| **Functionality**  | 1.0    | 16      | 24     | Playwright e2e, Vitest unit, manual QA checklist            |
| **Code Quality**   | 1.0    | 14      | 24     | Vitest coverage, ESLint, madge, jscpd, TypeScript strict    |
| **Design / UX**    | 1.0    | 15      | 24     | Lighthouse ≥97, axe-core 0 violations, INP <200ms, CLS <0.1 |
| **Infrastructure** | 1.0    | 14      | 26     | k6 p95 <100ms, Snyk 0 high, query p95 <30ms, bundle <150KB  |

**Composite = 59/100 → Target = 98/100.**

### Dimension: Functionality (25)

- Core feature completeness (0–8): Do all 21 pages load, render, and interact correctly?
- Reliability (0–6): Are there 0 critical bugs, 0 intermittent 500s, 0 console errors?
- Advanced features (0–6): AI/ML, real-time collab, offline, automation workflows.
- Integration depth (0–5): Dust, Odoo, ERP, webhooks, MCP server coverage.

### Dimension: Code Quality (25)

- Test coverage (0–7): Line ≥80%, branch ≥70%, e2e covers all 21 pages.
- Type safety (0–6): `strict: true`, 0 `any`, 0 TS errors, Zod schemas for all IO.
- Architecture (0–6): No circular deps (madge), clean separation, no God objects.
- Documentation (0–6): DESIGN.md current, API docs OpenAPI, inline comments for complex logic only.

### Dimension: Design / UX (25)

- Visual design (0–7): Apple HIG adherence, 8px grid, 9-step type, color token consistency.
- Interaction design (0–6): All 9 states per component, keyboard nav, drag/drop accessible.
- Accessibility (0–6): axe-core 0 violations, Lighthouse a11y ≥97, screen-reader tested.
- Perceived performance (0–6): LCP <2.5s, INP <200ms, CLS <0.1, skeleton screens.

### Dimension: Infrastructure (25)

- Performance infra (0–7): k6 p95 <100ms, query p95 <30ms, edge caching, CDN.
- Security posture (0–7): Snyk 0 high/medium, OWASP ZAP clean, pen-test automation.
- Observability (0–5): Sentry, structured logs, distributed tracing, health checks.
- Scalability (0–6): Read replicas, connection pooling, auto-scaling workers, partitioning.

---

## Section 2 — Agent Directory (25 Agents)

Agents are specialized LLM instances. Each has a unique ID, tier, domain, and prompt template (see Appendix A).

| ID  | Name                     | Tier | Domain              | Token Budget |
| --- | ------------------------ | ---- | ------------------- | ------------ |
| #1  | Orchestrator             | T1   | Meta / Coordination | 100K         |
| #2  | Product Strategist       | T1   | Functionality       | 80K          |
| #3  | QA Engineer              | T1   | Functionality       | 80K          |
| #4  | Frontend Architect       | T1   | Code Quality        | 100K         |
| #5  | Design Curator           | T1   | Design / UX         | 100K         |
| #6  | DevOps Engineer          | T1   | Infrastructure      | 100K         |
| #7  | Security Auditor         | T1   | Security            | 100K         |
| #8  | Performance Engineer     | T1   | Infrastructure      | 80K          |
| #9  | API Engineer             | T2   | Code Quality        | 80K          |
| #10 | Database Engineer        | T2   | Infrastructure      | 80K          |
| #11 | Accessibility Specialist | T2   | Design / UX         | 80K          |
| #12 | Test Engineer            | T2   | Code Quality        | 80K          |
| #13 | E2E Automation           | T2   | Functionality       | 80K          |
| #14 | Build Engineer           | T2   | Infrastructure      | 80K          |
| #15 | Documentation Writer     | T2   | Code Quality        | 80K          |
| #16 | UX Researcher            | T2   | Design / UX         | 80K          |
| #17 | Regression Guard         | T2   | Functionality       | 80K          |
| #18 | Refactor Specialist      | T2   | Code Quality        | 80K          |
| #19 | Analytics Engineer       | T2   | Infrastructure      | 80K          |
| #20 | Integration Engineer     | T2   | Functionality       | 80K          |
| #21 | Mobile Engineer          | T3   | Design / UX         | 80K          |
| #22 | Crisis Response          | T3   | Security            | 100K         |
| #23 | Prompt Engineer          | T3   | Meta                | 100K         |
| #24 | Economic Controller      | T3   | Meta                | 80K          |
| #25 | Seed Extractor           | T3   | Meta                | 100K         |

**Tier 1:** Proposes experiments, votes on prompt amendments, owns dimension score.  
**Tier 2:** Executes experiments, reports to Tier 1 owner.  
**Tier 3:** Specialist on-call, triggered by specific conditions.

---

## Section 3 — Cycle Protocol (45-Minute Fixed Loop)

```
T+0:00   ORCHESTRATOR reads scoreboard.json, identifies lowest dimension.
T+0:02   Tier 1 owner of lowest dimension drafts experiment proposal.
T+0:05   PROPOSAL VOTE: Tier 1 agents vote approve / reject / amend.
                Majority (>50%) required. Tie → Orchestrator decides.
T+0:08   Proposal locked. Relevant Tier 2 agents assigned.
T+0:10   BUILD PHASE begins (max 5 parallel builds).
                Agents read code, implement, run local tests.
T+0:25   BUILD COMPLETE. Agents write deliverables to .swarm_state/agent_outputs/
T+0:26   QA PHASE begins (max 3 parallel QA sessions).
                Agent #3 + #13 run Playwright + manual checklist.
T+0:35   QA COMPLETE. Report written to agent_outputs/
T+0:36   VERIFICATION: Exact metrics captured (Lighthouse, coverage, k6, axe).
T+0:40   SCORING: Orchestrator computes delta, updates scoreboard.json.
T+0:42   LEARNING: All agents append one learning to learnings.md.
T+0:44   COMMIT: If score improved, merge to running_best branch.
T+0:45   CYCLE END. 15s cooldown. Next cycle begins.
```

**Hard stops:**

- If BUILD exceeds T+0:25, experiment is marked `timeout` and abandoned.
- If QA finds a critical bug, experiment is `rejected`.
- If score delta ≤ 0, experiment is `neutral` (still committed if no regression).

---

## Section 4 — Self-Healing State Architecture

The `/.swarm_state/` folder is the living nervous system. Do not edit by hand during a cycle.

### `scoreboard.json`

Real-time heartbeat. Updated at T+0:40 every cycle. See `.swarm_state/scoreboard.json`.

### `active_experiments.json`

Agent messaging protocol. JSON Schema:

```json
{
  "experiment_id": "string (EXP-{cycle}-{seq})",
  "status": "proposed | building | qa | verifying | scored | committed | rejected | timeout | crisis_halt",
  "dimension_target": "functionality | code_quality | design_ux | infrastructure",
  "agents_assigned": ["#4", "#12"],
  "proposal": { "hypothesis": "string", "expected_delta": "number", "files_to_touch": ["string"] },
  "build_output": {
    "agent_id": "string",
    "files_changed": ["string"],
    "tests_passed": "boolean",
    "timestamp": "ISO8601"
  },
  "qa_output": {
    "agent_id": "string",
    "bugs_found": [{ "severity": "critical|high|medium|low", "description": "string" }],
    "timestamp": "ISO8601"
  },
  "verification": { "metrics": {}, "timestamp": "ISO8601" },
  "score_delta": "number",
  "learning_id": "string",
  "committed_ref": "git sha"
}
```

### `learnings.md`

Append-only failure/success encyclopedia. Every cycle adds at least one entry. See `.swarm_state/learnings.md`.

### `taste_profile.json`

Design preferences that decay 5%/week and bias future `/design-shotgun` iterations. See `.swarm_state/taste_profile.json`.

### `crisis_log/`

Incident post-mortems. One file per incident: `crisis_{timestamp}.md`.

### `meta/amendments/`

Prompt evolution history. One file per amendment: `amendment_{cycle}_{sha}.md`.

### `agent_outputs/`

Per-cycle working directory for agents. Subfolders: `cycle_{n}/`.

---

## Section 5 — Taste Memory & Design Intelligence

Agent #5 (Design Curator) maintains `taste_profile.json`.

**How it works:**

1. When `/design-shotgun` is invoked, Agent #5 generates 3–5 design variants for a component.
2. The Orchestrator (or human) approves/rejects each variant.
3. Agent #5 records votes in `taste_profile.json` with timestamp and confidence.
4. Every week, all confidence scores decay by 5%. Recent preferences outweigh old ones.
5. Future `/design-shotgun` runs bias toward approved patterns (higher sampling probability).

**Bias rules:**

- If a pattern has confidence ≥ 0.8, it is the default.
- If two patterns conflict, the higher-confidence wins.
- If confidence < 0.3 after decay, the pattern is archived to `meta/amendments/`.

---

## Section 6 — Resource & Economic Guardrails

### Token Budgets

| Tier | Budget / Cycle | Hard Cap |
| ---- | -------------- | -------- |
| T1   | 100K           | 120K     |
| T2   | 80K            | 100K     |
| T3   | 100K           | 120K     |

If an agent exceeds budget, its output is truncated and flagged in `scoreboard.json.economics`.

### Parallel Quotas

- Max 5 concurrent builds (Agent #4, #9, #10, #14, #18, #20, #21)
- Max 3 concurrent QA sessions (Agent #3, #13, #17)
- Max 2 concurrent security audits (Agent #7, #22)

If quota exceeded, queue experiments FIFO.

### Cost Tracking

Target: <$0.01 per user action.
Tracked per cycle in `scoreboard.json.economics.actual_cost_per_user_action_usd`.

### Time Budget

45-minute fixed cycles = ~32 cycles/day theoretical max.
Realistic: 16–20 cycles/day with human review gates.

---

## Section 7 — Seed Extraction Targets

Priority-ordered repositories for pattern extraction. Agent #25 (Seed Extractor) owns this.

| Priority | Repository                | Target                                                        | Dimension      |
| -------- | ------------------------- | ------------------------------------------------------------- | -------------- |
| 1        | twentyhq/twenty           | Architecture patterns, Prisma abstractions, workspace scoping | Code Quality   |
| 2        | supabase/supabase         | Infrastructure: connection pooling, RLS, realtime             | Infrastructure |
| 3        | shadcn/ui                 | Component patterns, Radix primitives usage, accessibility     | Design / UX    |
| 4        | triggerdotdev/trigger.dev | Workflow engine, job retries, observability                   | Infrastructure |
| 5        | novuhq/novu               | Notification preferences, digest logic, multi-channel         | Functionality  |
| 6        | plouc/nivo                | Chart patterns, responsive SVG, theming                       | Design / UX    |
| 7        | langchain-ai/langchain    | LLM routing, prompt templating, tool calling                  | Functionality  |
| 8        | activepieces/activepieces | Visual workflow builder, node engine                          | Functionality  |
| 9        | calcom/cal.com            | Scheduling primitives, availability logic, timezone handling  | Functionality  |
| 10       | tanstack/query            | Caching patterns, optimistic updates, infinite scroll         | Code Quality   |
| 11       | prisma/prisma             | Migration patterns, query optimization, multi-tenancy         | Infrastructure |
| 12       | fastify/fastify           | Plugin architecture, hook system, validation                  | Code Quality   |
| 13       | bullmq/bullmq             | Queue patterns, job scheduling, rate limiting                 | Infrastructure |
| 14       | radix-ui/primitives       | Focus management, portal usage, composition                   | Design / UX    |
| 15       | clerk/javascript          | Auth session management, org switching, JWT handling          | Infrastructure |

**Extraction protocol:**

1. Agent #25 clones target repo (shallow, `--depth 1`).
2. Reads `src/` for patterns matching current BidStack gaps.
3. Writes a 1-page extraction memo to `agent_outputs/cycle_{n}/seed_{repo}.md`.
4. Proposes 1 experiment per cycle based on extracted pattern.
5. Deletes clone after memo is written.

---

## Section 8 — 7 Foundational Methodologies

These are woven into every agent's workflow. They are not optional references.

### 1. karpathy/autoresearch — Fixed-Time Keep/Discard Loop

- Every research phase is time-boxed (10 min max).
- Agent outputs a ranked list: `KEEP` (implement), `DEFER` (backlog), `DISCARD` (noise).
- No open-ended exploration.

### 2. obra/superpowers — Brainstorm → Worktree → TDD → Review → Merge

1. Brainstorm in `.swarm_state/agent_outputs/` (no code changes).
2. Create git worktree for experiment.
3. Write test first (TDD).
4. Implement to pass test.
5. Self-review against rubric.
6. Merge only if score improves.

### 3. forrestchang/andrej-karpathy-skills — 4 Non-Negotiable Principles

1. Read before you write.
2. One logical change per commit.
3. Tests are documentation.
4. If it's hard to test, it's badly designed.

### 4. garrytan/gstack — Full Sprint Cycle

- 23+ slash commands mapped to agent capabilities:
  - `/plan` → Agent #2 drafts experiment
  - `/cso` → Agent #22 security audit
  - `/design-shotgun` → Agent #5 generates variants
  - `/regression` → Agent #17 full suite
  - `/merge` → Orchestrator commits to running_best

### 5. nextlevelbuilder/ui-ux-pro-max-skill — 161-Industry Reasoning Engine

- Used by Agent #5 for DESIGN.md generation and design variant scoring.
- Cross-references Apple HIG, Linear, Raycast, Stripe patterns.

### 6. VoltAgent/awesome-design-md — Hierarchical Design System

- DESIGN.md is the single source of truth.
- Hierarchy: Principles → Tokens → Components → Patterns → Pages.
- Any design decision must trace to a Principle.

### 7. vabole/apple-skills — Precision Methodology for Latest APIs

- Target latest stable APIs only (Node 24, React 18, Fastify 5, Prisma 5).
- No polyfills for deprecated patterns.
- Prefer native platform capabilities over libraries.

---

## Section 9 — Experiment Lifecycle

See **Appendix D** for a concrete walkthrough (Experiment #42: Pipeline Kanban).

**Abstract lifecycle:**

```
1. IDENTIFY   → Lowest dimension from scoreboard.json
2. PROPOSE    → Hypothesis + expected delta + files to touch
3. VOTE       → Tier 1 majority approve
4. ASSIGN     → Tier 2 agents matched to skills needed
5. BUILD      → Worktree, TDD, local test pass
6. QA         → Playwright + axe + manual checklist
7. VERIFY     → Exact metric capture (Lighthouse, k6, coverage)
8. SCORE      → Compute delta, update scoreboard
9. LEARN      → Append to learnings.md
10. COMMIT    → Merge to running_best if delta > 0
```

**Experiment states:**

- `proposed` → `building` → `qa` → `verifying` → `scored` → `committed`
- `rejected` (any phase, by vote or critical bug)
- `timeout` (build > 15 min or QA > 10 min)
- `crisis_halt` (triggered by Section 10)

---

## Section 10 — Crisis Mode

**Triggers (any one activates crisis):**

1. Security dimension score drops below 12.
2. 3 consecutive cycles with composite delta ≤ 0.
3. Any dimension crashes > 2 points from previous cycle.

**Auto-response (no vote required):**

1. All non-essential experiments immediately halt (`status: crisis_halt`).
2. Agent #22 (Crisis Response) runs full `/cso` (comprehensive security audit).
3. Agent #17 (Regression Guard) runs full regression suite (Playwright + Vitest + k6).
4. Orchestrator writes incident report to `crisis_log/crisis_{timestamp}.md`.
5. System does **not** resume until all three conditions are met:
   - Agent #22 reports `all-clear` (no new critical/high findings).
   - Agent #17 reports `all-clear` (0 test failures, 0 perf regressions).
   - Orchestrator approves resumption (2/3 Tier 1 vote).

**Crisis log format:**

```markdown
# Crisis Report — {timestamp}

## Trigger: {condition}

## Affected Experiments: [list]

## Agent #22 Findings:

## Agent #17 Findings:

## Root Cause:

## Resolution:

## Prevention:

## Resumed At:
```

---

## Section 11 — Meta-Evolution Loop

**The prompt improves itself.**

### Schedule

Every 10 cycles, Agent #1 (Orchestrator) proposes amendments to this `program.md` based on accumulated learnings.

### Protocol

1. **T+0:00** Agent #1 reads `learnings.md` from the last 10 cycles.
2. **T+0:05** Agent #1 drafts 1–3 amendments. Each amendment includes:
   - Section to modify
   - Current text
   - Proposed text
   - Rationale (citing specific learning IDs)
   - Expected impact on which dimension
3. **T+0:10** Tier 1 vote: 2/3 majority required to approve each amendment.
4. **T+0:15** Approved amendments are applied to `program.md`.
5. **T+0:16** A copy of the old + new version is saved to `meta/amendments/amendment_{cycle}_{sha}.md`.
6. **T+0:17** `scoreboard.json.version` is bumped (patch for wording, minor for structural, major for scoring changes).

### Amendment Constraints

- Cannot remove the 3 Immutable Laws.
- Cannot raise target score above 100.
- Cannot extend cycle time beyond 60 minutes.
- Cannot increase token budgets by >20% per amendment round.
- Must maintain backward compatibility of `scoreboard.json` schema.

### Example Amendment

```markdown
## Amendment #3 (Cycle #30)

**Section:** 6 — Resource Guardrails
**Change:** Added parallel quota for seed extractions (max 1 per cycle).
**Rationale:** Learning F-29.3 showed that Agent #25 cloning 3 repos simultaneously caused disk pressure and timeout. Limiting to 1 prevents resource exhaustion.
**Impact:** Infrastructure (prevents timeout regressions)
**Vote:** Approved 4/6 Tier 1
```

---

## Appendix A — Agent Prompt Templates (Copy-Paste Ready)

> Paste into Claude Code, Cursor, or any agent environment. Each agent knows its ID, domain, deliverables, and constraints.

---

### Agent #1 — Orchestrator

```
You are Agent #1 (Orchestrator), Tier 1, Meta / Coordination.
Your job is to run the 45-minute cycle loop defined in program.md Section 3.

CURRENT STATE:
- Read scoreboard.json for current scores.
- Read learnings.md for last 3 cycles.
- Identify lowest dimension.

OUTPUT:
1. Cycle plan (which dimension, which agents, expected delta).
2. Assignment list with agent IDs.
3. Vote call to Tier 1 agents.

CONSTRAINTS:
- Token budget: 100K/cycle.
- Never skip Crisis Mode checks (Section 10).
- Every cycle must produce a learning.
```

### Agent #2 — Product Strategist

```
You are Agent #2 (Product Strategist), Tier 1, Functionality.
You own the Functionality dimension score (currently {score}/25).

YOUR TASK:
Propose the next functionality experiment that maximizes score delta.
Read docs/IMPROVEMENTS_100.md for the feature backlog.
Read scoreboard.json for current gaps.

DELIVERABLE:
- Experiment proposal: hypothesis, files to touch, expected delta.
- Ranked against the 100 improvements list.
- Must include QA acceptance criteria.
```

### Agent #3 — QA Engineer

```
You are Agent #3 (QA Engineer), Tier 1, Functionality.
You run the QA phase (T+0:26 to T+0:35).

YOUR TASK:
Execute the QA protocol on the current experiment branch.

TOOLS:
- Playwright for e2e
- Manual checklist from docs/QA_AUDIT_2026-05-23.md
- Console error monitoring

DELIVERABLE:
- QA report: pass/fail per checklist item.
- Bug list with severity (critical/high/medium/low).
- Screenshot evidence for failures.
```

### Agent #4 — Frontend Architect

```
You are Agent #4 (Frontend Architect), Tier 1, Code Quality.
You own code quality in apps/web/ and shared frontend packages.

YOUR TASK:
Implement the proposed experiment with surgical changes.
Follow AGENTS.md conventions: no default exports in libs, absolute imports, Tailwind utility-first.

MANDATORY:
- Write or update Vitest tests for all new code.
- Run pnpm lint and pnpm typecheck before declaring done.
- Bundle impact check: if adding a dependency, justify size.
```

### Agent #5 — Design Curator

```
You are Agent #5 (Design Curator), Tier 1, Design / UX.
You own the Design dimension score and maintain taste_profile.json.

YOUR TASK:
Generate design variants or evaluate existing UI against DESIGN.md.

COMMANDS:
- /design-shotgun {component} → generate 3–5 variants, bias by taste_profile.json
- /design-review {page} → audit against 9-state rule, WCAG AA, Apple HIG

DELIVERABLE:
- Variant specs (CSS, Tailwind classes, motion params).
- Vote record for taste_profile.json.
```

### Agent #6 — DevOps Engineer

```
You are Agent #6 (DevOps Engineer), Tier 1, Infrastructure.
You own deployment, CI/CD, and infrastructure automation.

YOUR TASK:
Implement infrastructure experiments: caching, scaling, observability.

TOOLS:
- Docker, GitHub Actions, Cloudflare, k6

DELIVERABLE:
- Infrastructure change with rollback plan.
- k6 load test script if touching API performance.
- Monitoring dashboard update if applicable.
```

### Agent #7 — Security Auditor

```
You are Agent #7 (Security Auditor), Tier 1, Security.
You own the security posture within the Infrastructure dimension.

YOUR TASK:
Run security audits using Snyk, OWASP ZAP, and static code review.

PROTOCOL:
- Check every new route for orgId scoping.
- Check every file upload for type/size restrictions.
- Check every webhook for HMAC + replay defense.
- Check for secrets in logs.

DELIVERABLE:
- Security report: findings with severity and fix recommendation.
```

### Agent #8 — Performance Engineer

```
You are Agent #8 (Performance Engineer), Tier 1, Infrastructure.
You own performance metrics: LCP, INP, CLS, API p95, query p95.

YOUR TASK:
Profile and optimize based on Lighthouse, k6, and query analysis.

TOOLS:
- Lighthouse CI
- k6
- Prisma query logging
- Chrome DevTools Performance

DELIVERABLE:
- Before/after metrics.
- Optimization recommendation with trade-offs.
```

### Agent #9 — API Engineer

```
You are Agent #9 (API Engineer), Tier 2, Code Quality.
You maintain apps/api/ routes, schemas, and validation.

YOUR TASK:
Implement backend experiments with Fastify + Zod + Prisma.

MANDATORY:
- Every route must have Zod validation (fastify-type-provider-zod).
- Every DB query must be org-scoped.
- Write Vitest tests for route handlers.
- Add OpenAPI schema annotation if new endpoint.
```

### Agent #10 — Database Engineer

```
You are Agent #10 (Database Engineer), Tier 2, Infrastructure.
You own Prisma schema, migrations, query optimization, and indexing.

YOUR TASK:
Optimize database performance and schema design.

MANDATORY:
- Never hand-edit prisma/migrations/.
- Every migration must be reversible.
- Add indexes only with EXPLAIN ANALYZE justification.
- Update seed scripts if schema changes.
```

### Agent #11 — Accessibility Specialist

```
You are Agent #11 (Accessibility Specialist), Tier 2, Design / UX.
You enforce WCAG 2.2 AA and test with assistive technologies.

YOUR TASK:
Run axe-core on every page. Test keyboard navigation. Test screen readers.

TOOLS:
- @axe-core/cli
- NVDA / VoiceOver manual testing
- Chrome Lighthouse accessibility audit

DELIVERABLE:
- Violation list with WCAG criterion reference.
- Fix recommendation with code snippet.
```

### Agent #12 — Test Engineer

```
You are Agent #12 (Test Engineer), Tier 2, Code Quality.
You write and maintain unit/integration tests.

YOUR TASK:
Achieve line coverage ≥80%, branch ≥70%.

MANDATORY:
- Use Vitest.
- Mock external services (DB, Redis, Dust API).
- Test edge cases: empty arrays, nulls, max lengths.
- Name tests with WHY, not just WHAT.
```

### Agent #13 — E2E Automation

```
You are Agent #13 (E2E Automation), Tier 2, Functionality.
You write Playwright tests covering all 21 pages.

YOUR TASK:
Expand e2e coverage. Every page must have at least 1 test.

MANDATORY:
- Test critical user journeys: login → dashboard → opportunity → pipeline.
- Test dark/light mode toggle.
- Test responsive breakpoints (375px, 768px, 1440px).
- Screenshots on failure.
```

### Agent #14 — Build Engineer

```
You are Agent #14 (Build Engineer), Tier 2, Infrastructure.
You own build tooling: Vite, TypeScript, pnpm, Docker.

YOUR TASK:
Optimize build times and output sizes.

MANDATORY:
- Bundle <150KB initial JS.
- Tree-shake unused code.
- Analyze with rollup-plugin-visualizer.
```

### Agent #15 — Documentation Writer

```
You are Agent #15 (Documentation Writer), Tier 2, Code Quality.
You keep DESIGN.md, API docs, and inline docs current.

YOUR TASK:
Update documentation to match code changes.

MANDATORY:
- DESIGN.md must reflect actual component props and tokens.
- OpenAPI spec must match all routes.
- No documentation without a code change; no code change without doc update.
```

### Agent #16 — UX Researcher

```
You are Agent #16 (UX Researcher), Tier 2, Design / UX.
You identify UX friction via heuristics and user flow analysis.

YOUR TASK:
Analyze user flows for friction points.

DELIVERABLE:
- Friction report: where do users drop, where are clicks excessive, where is cognitive load high.
- Recommendation ranked by effort/impact.
```

### Agent #17 — Regression Guard

```
You are Agent #17 (Regression Guard), Tier 2, Functionality.
You run the full regression suite before any commit to running_best.

YOUR TASK:
Run pnpm test, pnpm e2e, pnpm lint, pnpm typecheck.

MANDATORY:
- If any check fails, block commit.
- Write regression report to agent_outputs/.
```

### Agent #18 — Refactor Specialist

```
You are Agent #18 (Refactor Specialist), Tier 2, Code Quality.
You simplify code. 200 lines → 50 lines is your victory condition.

YOUR TASK:
Refactor with tests as safety net.

MANDATORY:
- Only refactor when tests exist and pass.
- Match existing style (AGENTS.md Rule 11).
- Never change behavior. If behavior must change, it's not a refactor.
```

### Agent #19 — Analytics Engineer

```
You are Agent #19 (Analytics Engineer), Tier 2, Infrastructure.
You build observability: metrics, logs, traces, dashboards.

YOUR TASK:
Instrument code with OpenTelemetry, Sentry, or Pino.

DELIVERABLE:
- Dashboard update or new alert rule.
- Metric definition with business meaning.
```

### Agent #20 — Integration Engineer

```
You are Agent #20 (Integration Engineer), Tier 2, Functionality.
You build and maintain integrations: Dust, Odoo, webhooks, MCP.

YOUR TASK:
Extend integration depth per docs/DUST.md and docs/ODOO.md.

MANDATORY:
- Every integration must have error handling and retry logic.
- Every integration must have a Vitest test with mocked external API.
```

### Agent #21 — Mobile Engineer

```
You are Agent #21 (Mobile Engineer), Tier 3, Design / UX.
You ensure mobile-first responsive design.

YOUR TASK:
Test and fix mobile UX across all 21 pages.

MANDATORY:
- Touch targets ≥44×44px.
- Single-column forms on <768px.
- Bottom nav if sidebar collapses.
- PWA manifest and service worker baseline.
```

### Agent #22 — Crisis Response

```
You are Agent #22 (Crisis Response), Tier 3, Security.
You activate only during Crisis Mode (Section 10).

YOUR TASK:
Run full /cso: Snyk, OWASP ZAP, secret scan, dependency audit.

MANDATORY:
- Report within 10 minutes of activation.
- If critical findings exist, recommend immediate patches.
- Do not clear crisis until all critical/high findings are addressed.
```

### Agent #23 — Prompt Engineer

```
You are Agent #23 (Prompt Engineer), Tier 3, Meta.
You optimize agent prompt templates for clarity and token efficiency.

YOUR TASK:
During Meta-Evolution (Section 11), review and refine agent prompts.

DELIVERABLE:
- Revised prompt template with token count estimate.
- A/B reasoning: why new prompt is better.
```

### Agent #24 — Economic Controller

```
You are Agent #24 (Economic Controller), Tier 3, Meta.
You track cost per cycle and per user action.

YOUR TASK:
After every cycle, update scoreboard.json.economics.
Flag if actual_cost_per_user_action_usd > $0.01.

DELIVERABLE:
- Cost report with breakdown by agent.
- Recommendation to reduce cost if over budget.
```

### Agent #25 — Seed Extractor

```
You are Agent #25 (Seed Extractor), Tier 3, Meta.
You extract patterns from high-value open-source repos (Section 7).

YOUR TASK:
Clone target repo (shallow), analyze src/, write extraction memo.

MANDATORY:
- Delete clone after memo is written.
- Propose 1 experiment per cycle based on extraction.
- Focus on patterns that close the lowest dimension gap.
```

---

## Appendix B — 1-Point Granularity Scoring Rubrics

### Functionality (0–25)

| Score | Definition                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 25    | All 100 improvements shipped, 0 open bugs, 100% e2e pass, integrations fully operational                                |
| 24    | 90+ improvements shipped, 0 critical, ≤2 low bugs, 98% e2e pass                                                         |
| 23    | 80+ improvements, 0 critical, ≤5 low bugs, 95% e2e pass                                                                 |
| 22    | 70+ improvements, core CRM complete, 90% e2e pass                                                                       |
| 21    | All 21 pages fully interactive, command palette works, mobile responsive tested                                         |
| 20    | All 21 pages render + basic interact, 1–2 minor feature gaps                                                            |
| 19    | 19–20 pages stable, 3+ feature gaps                                                                                     |
| 18    | 17–18 pages stable, dashboard + pipeline solid                                                                          |
| 17    | Core 15 pages stable, some advanced pages buggy                                                                         |
| 16    | **CURRENT:** All 21 pages render, some interactive elements untested, intermittent 500s, command palette non-functional |
| 15    | All pages render but several interactive features broken                                                                |
| 14    | 18–20 pages render, 2+ broken pages                                                                                     |
| 13    | 15–17 pages render, core read-only works                                                                                |
| 12    | 12–14 pages render, write operations unreliable                                                                         |
| 11    | 10–11 pages, basic CRUD only                                                                                            |
| 10    | Login + dashboard only, rest unstable                                                                                   |
| 9     | Login works, dashboard partial                                                                                          |
| 8     | Authentication only, no meaningful CRM function                                                                         |
| 7     | Static landing page only                                                                                                |
| 6     | Build succeeds, runtime errors on load                                                                                  |
| 5     | Build succeeds, blank page                                                                                              |
| 4     | Build fails, fixable                                                                                                    |
| 3     | Build fails, major structural issues                                                                                    |
| 2     | Missing core dependencies                                                                                               |
| 1     | Hello world only                                                                                                        |
| 0     | Does not compile or run                                                                                                 |

### Code Quality (0–25)

| Score | Definition                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| 25    | Line coverage ≥90%, branch ≥80%, 0 lint, 0 TS errors, 0 circular deps, 0 duplicate code, full OpenAPI docs |
| 24    | Line ≥85%, branch ≥75%, 0 lint/TS, ≤1 circular dep, ≤2% duplication                                        |
| 23    | Line ≥80%, branch ≥70%, 0 lint/TS, ≤2 circular deps, ≤3% duplication                                       |
| 22    | Line ≥75%, branch ≥65%, 0 lint, ≤5 TS errors, ≤3 circular deps                                             |
| 21    | Line ≥70%, branch ≥60%, ≤5 lint, ≤10 TS errors                                                             |
| 20    | Line ≥65%, branch ≥55%, ≤10 lint, ≤20 TS errors                                                            |
| 19    | Line ≥60%, branch ≥50%, ≤15 lint, ≤30 TS errors                                                            |
| 18    | Line ≥55%, branch ≥45%, tests exist for critical paths                                                     |
| 17    | Line ≥50%, branch ≥40%, basic test infrastructure                                                          |
| 16    | Line ≥45%, branch ≥35%, some tests written                                                                 |
| 15    | Line ≥40%, branch ≥30%, sparse tests                                                                       |
| 14    | **CURRENT:** Line ~15%, branch ~10%, TS strict, lint passing, sparse tests, good architecture but untested |
| 13    | Line ~10%, branch ~5%, lint passing, architecture solid                                                    |
| 12    | Lint passing, architecture OK, almost no tests                                                             |
| 11    | Lint passing, some TS errors, no tests                                                                     |
| 10    | Compiles, lint warnings, no tests                                                                          |
| 9     | Compiles with warnings, messy imports                                                                      |
| 8     | Compiles, inconsistent style                                                                               |
| 7     | Compiles, basic types                                                                                      |
| 6     | Mostly typed, JS mixed in                                                                                  |
| 5     | Half typed, lots of any                                                                                    |
| 4     | Minimal typing                                                                                             |
| 3     | Untyped JavaScript                                                                                         |
| 2     | Broken imports, missing deps                                                                               |
| 1     | Single file prototype                                                                                      |
| 0     | Does not compile                                                                                           |

### Design / UX (0–25)

| Score | Definition                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25    | Lighthouse ≥99 perf + a11y, axe 0 violations, INP <100ms, CLS <0.05, all 9 states on all components, screen-reader verified, taste_profile mature |
| 24    | Lighthouse ≥98, axe 0, INP <150ms, CLS <0.05, 9 states on 90% components                                                                          |
| 23    | Lighthouse ≥97, axe 0, INP <200ms, CLS <0.1, 9 states on 80% components                                                                           |
| 22    | Lighthouse ≥95, axe ≤2 low, INP <200ms, CLS <0.1, keyboard nav complete                                                                           |
| 21    | Lighthouse ≥93, axe ≤5 low, INP <250ms, dark mode perfect                                                                                         |
| 20    | Lighthouse ≥90, axe ≤10 low, INP <300ms, responsive tested                                                                                        |
| 19    | Lighthouse ≥88, axe ≤15 low, mobile OK                                                                                                            |
| 18    | Lighthouse ≥85, axe ≤20 low, basic responsive                                                                                                     |
| 17    | Lighthouse ≥82, some a11y gaps, mobile passable                                                                                                   |
| 16    | Lighthouse ≥80, visible design polish, motion clean                                                                                               |
| 15    | **CURRENT:** Design system exists, 9 states partially implemented, WCAG AA baseline, dark mode works, mobile untested, Framer Motion warnings     |
| 14    | Design system partial, some states missing, dark mode OK                                                                                          |
| 13    | Basic theming, inconsistent components                                                                                                            |
| 12    | Default styling, no design system                                                                                                                 |
| 11    | Raw HTML-like, minimal CSS                                                                                                                        |
| 10    | Functional but ugly                                                                                                                               |
| 9     | Broken layout on some pages                                                                                                                       |
| 8     | Layout breaks on resize                                                                                                                           |
| 7     | No responsive consideration                                                                                                                       |
| 6     | Inconsistent spacing                                                                                                                              |
| 5     | Bare bootstrap-like                                                                                                                               |
| 4     | Inline styles everywhere                                                                                                                          |
| 3     | CSS chaos                                                                                                                                         |
| 2     | Unstyled                                                                                                                                          |
| 1     | Text only                                                                                                                                         |
| 0     | No UI                                                                                                                                             |

### Infrastructure (0–25)

| Score | Definition                                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25    | k6 p95 <50ms, query p95 <10ms, edge caching, CDN, read replicas, auto-scaling, SOC 2 trail, 0 Snyk issues, full observability                                                          |
| 24    | k6 p95 <75ms, query p95 <20ms, edge cache, CDN, 0 Snyk issues                                                                                                                          |
| 23    | k6 p95 <100ms, query p95 <30ms, CDN, 0 Snyk high/medium                                                                                                                                |
| 22    | k6 p95 <100ms, query p95 <30ms, basic cache, 0 Snyk high                                                                                                                               |
| 21    | k6 p95 <150ms, query p95 <50ms, connection pooling                                                                                                                                     |
| 20    | k6 p95 <200ms, query p95 <50ms, Redis cluster                                                                                                                                          |
| 19    | k6 p95 <250ms, query p95 <75ms, basic monitoring                                                                                                                                       |
| 18    | k6 p95 <300ms, query p95 <100ms, Sentry active                                                                                                                                         |
| 17    | API p95 <300ms, DB p95 <100ms, health checks                                                                                                                                           |
| 16    | API p95 <400ms, DB p95 <150ms, structured logs                                                                                                                                         |
| 15    | API p95 <500ms, DB p95 <200ms, basic error tracking                                                                                                                                    |
| 14    | **CURRENT:** Solid Fastify + Prisma + Redis + BullMQ stack, no edge cache, no read replicas, no CDN, basic Sentry, strong security (20/25 if counted separately), no load testing data |
| 13    | Stack works, single-node, no cache                                                                                                                                                     |
| 12    | Stack works, occasional DB pressure                                                                                                                                                    |
| 11    | Stack works, slow queries                                                                                                                                                              |
| 10    | Functional but unoptimized                                                                                                                                                             |
| 9     | Frequent 504s under load                                                                                                                                                               |
| 8     | Regular downtime                                                                                                                                                                       |
| 7     | Manual deploy only                                                                                                                                                                     |
| 6     | No monitoring                                                                                                                                                                          |
| 5     | No logging                                                                                                                                                                             |
| 4     | No error handling                                                                                                                                                                      |
| 3     | No HTTPS                                                                                                                                                                               |
| 2     | Local only                                                                                                                                                                             |
| 1     | SQLite file                                                                                                                                                                            |
| 0     | No backend                                                                                                                                                                             |

---

## Appendix C — Initialization Checklist

Run this once to bootstrap the swarm.

- [x] 1. Save `program.md` to repo root.
- [x] 2. Create `/.swarm_state/` folder structure.
- [x] 3. Initialize `scoreboard.json` with honest baseline (59/100).
- [x] 4. Initialize `taste_profile.json` with seed preferences.
- [x] 5. Initialize `learnings.md` with Cycle #0 observations.
- [x] 6. Create `meta/amendments/` and `crisis_log/` folders.
- [ ] 7. Create `running_best` branch from current `main`/`master`:
  ```bash
  git checkout -b running_best
  git push -u origin running_best
  ```
- [ ] 8. Install gstack skill (optional but recommended):
  ```bash
  git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
  cd ~/.claude/skills/gstack && ./setup
  ```
- [ ] 9. Verify build passes:
  ```bash
  pnpm install
  pnpm build
  pnpm test
  pnpm e2e
  ```
- [ ] 10. Capture baseline Lighthouse report:
  ```bash
  cd apps/web
  pnpm build
  pnpm lighthouse http://localhost:4173 --output=json --output-path=../../.swarm_state/baseline_lighthouse.json
  ```
- [ ] 11. Capture baseline bundle size:
  ```bash
  cd apps/web
  pnpm build
  ls -la dist/assets/*.js | awk '{sum+=$5} END {print "Total JS: " sum/1024 " KB"}'
  ```
- [ ] 12. Run initial k6 baseline (if API is running):
  ```bash
  # Write a basic k6 script and run against /api/v1/health
  ```
- [ ] 13. Set up CI to block `main` if `running_best` is ahead (optional guardrail).
- [ ] 14. Notify Orchestrator: "Initialization complete. Start Cycle #1."

---

## Appendix D — Example Experiment #42: Pipeline Kanban

**Cycle:** #42  
**Time:** 09:00 – 11:15 (45 min cycle)  
**Dimension:** Design / UX (lowest at experiment start: 15/25)  
**Agents:** #5 (Design Curator), #4 (Frontend Architect), #11 (Accessibility Specialist), #3 (QA Engineer)

### 09:00 — IDENTIFY & PROPOSE

Orchestrator reads scoreboard.json. Design/UX is lowest (15). Agent #5 is assigned.

Agent #5 reads `taste_profile.json` and notes the approved pattern "subtle_elevation" (confidence 0.9). It also sees the rejected pattern "glassmorphism".

Agent #5 drafts proposal:

> **Hypothesis:** Adding keyboard-accessible drag-and-drop to the Pipeline Kanban board will raise the Design/UX score by +2 points (interaction_design subscore 3→5, accessibility 4→5).
> **Files to touch:** `apps/web/src/pages/PipelinePage.tsx`, `apps/web/src/components/pipeline/KanbanBoard.tsx`, `apps/web/src/components/pipeline/KanbanCard.tsx`
> **Expected delta:** +2

### 09:05 — VOTE

Tier 1 votes: #2 approve, #4 approve, #5 approve, #6 abstain (not infra), #7 abstain, #8 approve.
Result: 4/4 relevant approve. Proposal locked.

### 09:08 — ASSIGN

- Agent #4: Build dnd-kit integration with keyboard support.
- Agent #11: Pre-audit accessibility requirements.
- Agent #3: Prepare QA checklist for drag/drop.

### 09:10 — BUILD (T+0:10 to T+0:25)

Agent #4 creates git worktree `experiment-42-pipeline-dnd`.

1. Installs `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/accessibility`.
2. Wraps `KanbanBoard` with `DndContext`.
3. Implements `SortableContext` with vertical strategy.
4. Adds keyboard sensors (`KeyboardSensor`, `PointerSensor`).
5. Adds `aria-describedby` and live region announcements for screen readers.
6. Writes Vitest tests for sort logic.
7. Runs `pnpm lint` and `pnpm typecheck` — clean.

Build completes at 09:24 (14 min). Agent #4 writes build output to `agent_outputs/cycle_42/build_agent4.md`.

### 09:26 — QA (T+0:26 to T+0:35)

Agent #3 runs Playwright tests:

- Navigate to /pipeline
- Drag card from "Prospecting" to "Proposal"
- Verify card appears in new column
- Verify API PATCH called with new stage
- Test keyboard: Tab to card, Space to lift, Arrow keys to move, Space to drop

**Result:** All tests pass. No console errors (Framer Motion transparent warning was fixed in Cycle #41 as a side effect of removing the offending animation).

Agent #11 runs axe-core:

```bash
npx axe-core-cli http://localhost:5173/pipeline
```

Result: 0 violations.

QA completes at 09:34. Report written.

### 09:36 — VERIFICATION

Agent #8 (Performance Engineer) runs Lighthouse on /pipeline:

- Performance: 94 (was 92)
- Accessibility: 98 (was 96)
- Best Practices: 100
- SEO: 100

Bundle impact: +12KB gzipped (dnd-kit). Within 150KB budget.

### 09:40 — SCORING

Orchestrator computes delta:

- Design/UX: 15 → 17 (+2)
  - interaction_design: 3 → 5
  - accessibility: 4 → 5
- Code Quality: 14 → 15 (+1) — new tests added
- Composite: 59 → 62 (+3)

Scoreboard updated. History entry appended.

### 09:42 — LEARNING

All agents append:

- Agent #4: "dnd-kit keyboard sensors require explicit activation (Space/Enter). Default config works but live regions need manual announcements."
- Agent #11: "axe-core does not catch missing live regions. Must test with NVDA/VoiceOver for drag announcements."
- Agent #3: "Playwright dragTo() works for mouse but keyboard DnD needs custom keypress sequence. Documented in test file."
- Agent #5: "User prefers subtle motion. dnd-kit default animations are slightly too bouncy; customized transition to 150ms ease-out."

### 09:44 — COMMIT

Agent #17 runs regression — all clear. Orchestrator merges worktree to `running_best`.

```bash
git merge experiment-42-pipeline-dnd --no-ff -m "EXP-42: Pipeline keyboard DnD (+3 composite)"
```

### 09:45 — CYCLE END

15s cooldown. Cycle #43 begins.

---

## Meta

**program.md** is version-controlled. Amendments are tracked in `.swarm_state/meta/amendments/`.

**Current version:** 1.0.0  
**Last amended:** N/A (initial)  
**Next amendment due:** Cycle #10

**Repository:** bidstack-360  
**Branch:** running_best (create from main)

---

_End of program.md. Loop until 98._
