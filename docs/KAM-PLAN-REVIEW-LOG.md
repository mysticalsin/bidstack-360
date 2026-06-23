# Plan Review Log: KAM front-layer technical brief

Started session 2026-06-23. MAX_ROUNDS=3. PLAN_FILE=docs/KAM-PLAN.md. Critic: Codex (gpt, read-only).

## Round 1 — Codex: FAILED (external)
Codex CLI 0.141.0 authenticated and session started (thread `019ef635-3e45-7a12-ba47-9bdc75116edc`), but the turn failed: **"You've hit your usage limit"** (ChatGPT-account credits exhausted; resets ~Jun 28). No critique produced. Not silently retried (per skill rule). **Substituted** an internal Claude red-team panel (5 adversarial lenses, read-only, fresh context) to keep the build moving honestly. Re-run Codex after credit reset for the cross-model check.

## Round 2 — Claude red-team panel (5 lenses): VERDICT REVISE
6 agents, 572k tokens, 178 tool calls. All 5 lenses REVISE. **8 deduped BLOCKERS** (B1-B8, most hit by 2-4 lenses) + **9 MAJORS** (M1-M9) + 8 minors + 4 disagreements.

BLOCKERS: B1 convert logic inline/non-extractable (+ a 2nd broken MCP convert) → extract `convertLeadTx`. B2 mint+handoff+update not one tx, no optimistic guard → double-mint. B3 cross-tenant FK graft on every referenced id. B4 in-tenant access-scope (ensureAccountVisible/applyCompanyScope) ignored. B5 split-brain account identity (Company.id vs cockpit name-slug vs accountKey normalizeName) + two divergent normalizers. B6 PII (consultant/attendee/transcript) has no encryption/redaction mechanism. B7 four un-gated never-auto-commit bypass paths (write-scoped MCP tools, dust-poll fallthrough, webhook AiInsight default-active, import-meeting). B8 RBAC(3 files)+SERUM(4 sites)+Prisma-regen chain compiles-but-403s; human-gate must be actor-role not permission-key (scope-collapse makes `kam:write` agent-passable).

### Claude's response
**Accepted all 8 blockers + all 9 majors + minors** — they are correct, well-cited, and each came with the exact fix. Rewrote docs/KAM-PLAN.md → v2 baking in: extracted `convertLeadTx`; single-tx optimistic-guarded transition; §2/§3 FK-graft + access-scope invariant block; canonical account-key decision (KAM FKs Company.id; cross-surface joins via ONE shared `normalizeAccountName`; backfill best-effort); PII_MAP additions + aiOptOut + transcript-PII ADR note; dedicated `kam` MCP scope + dust-poll/webhook/import-meeting gates + lowercase AiInsight status enum; 3-file RBAC lockstep + set==set test + actor-role human-gate; all migrations in S0 (one regen) + typecheck-deferred slices; KamProspection sync/manual key split + reconcile; lastActivityAt blind-set helper; explicit ALLOWED transition table (dropped terminal); slice reorder (prospection/KPI tools → S6); §8 DoD split agent-now vs operator-gated.
**Deferred to Tony (non-blocking, defaults applied):** D1 fixed 4-stage enum (Tony locked vocab → keep fixed); D3 `kam_update_task_status` direct flip (brief explicitly lists "update task status" as an MCP write → keep as audited, scope-validated carve-out on existing KAM tasks). Surfaced in the build summary.
**Codex cross-model pass still pending** (credit reset ~Jun 28) — v2 has not had the cross-MODEL check, only cross-context. Proceeding under autonomous /loop with extra test scrutiny on B1/B2/B3/B7 failure modes.

