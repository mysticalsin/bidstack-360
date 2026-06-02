# Crew — CrewAI-style multi-agent infrastructure (Wave 10)

A TypeScript port of CrewAI's structure, integrated into the RFP section so the
team can build role-based AI agents that answer each step of a bid response
(legal, finance, marketing, sales, technical, compliance, …).

> It's a port of the **structure**, not the Python code — CrewAI is Python,
> BidStack is Node/TS. The downloaded CrewAI repo was the semantic reference.

## Why infrastructure, not a tool

Admins **manage** the infrastructure; members **use** it:

| Capability                    | Admin | Member                        |
| ----------------------------- | ----- | ----------------------------- |
| Create / edit / delete agents | ✅    | ❌                            |
| Create / edit / delete crews  | ✅    | ❌                            |
| Load standard agents          | ✅    | ❌                            |
| Run a crew on an RFP          | ✅    | ✅                            |
| View a crew + run results     | ✅    | ✅ (own runs; admins see all) |

Enforced server-side on **every** mutation (`requireRole('admin')`); run reads
are owner-scoped (members see only their own runs). The Agent Studio UI hides
admin controls from members as defense-in-depth.

## Architecture

| Layer        | Where                                                             | What                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kit (engine) | `apps/worker/src/crew/`                                           | `Agent` / `Task` / `Crew` / `Process` types + `kickoff()` (sequential context-chaining + hierarchical manager consolidation). Executor-injected, fail-open, 15 unit tests. |
| Execution    | `apps/worker/src/crew/dust-executor.ts`                           | Realises an agent persona through one Dust agent; fail-open on missing key / failure.                                                                                      |
| Data         | `packages/db` (`crew_agents`, `crews`, `crew_tasks`, `crew_runs`) | Org-scoped; raw SQL (Wave-9 Windows-DLL-lock pattern). Migration `20260530010000_crew_infrastructure`.                                                                     |
| Queue        | `crew-run` (`apps/worker/src/queues/crew-run.ts`)                 | Loads a crew → `kickoff` → persists status + per-task results + final output.                                                                                              |
| API          | `apps/api/src/routes/crew-agents.ts`, `crews.ts`                  | Admin-gated CRUD + `POST /crews/:id/run` (member) + owner-scoped run reads.                                                                                                |
| Seed         | `apps/api/src/lib/crew-standard.ts`                               | 7 standard agents + a default hierarchical "RFP Response Crew". `POST /crews/seed-standard` (admin).                                                                       |
| UI           | `apps/web/src/pages/AgentStudioPage.tsx` (`/agent-studio`)        | Agent Studio — author agents (admin), run a crew + watch the result (member).                                                                                              |

## Standard agents

`Solution Architect` · `Compliance Officer` · `Legal Counsel` · `Finance Lead`
· `Marketing Strategist` · `Bid Manager` (the hierarchical manager). The default
**RFP Response Crew** runs requirements → compliance → legal → pricing →
win-themes, then the Bid Manager consolidates.

## How to use

1. **Admin** opens Agent Studio → **Load standard agents** (seeds the agents +
   the RFP Response Crew). Then edit any agent or add your own.
2. **Anyone** picks a crew → **Run**, pastes the RFP text, and watches each
   agent's step + the final consolidated response.

## Operational notes

- **LLM key:** with `DUST_API_KEY` + `DUST_WORKSPACE_ID` set (and an agent id via
  `DUST_CREW_AGENT_ID`), agents return real content. Without them they return
  labeled fail-open placeholders — the pipeline still runs end-to-end. Proven
  e2e against a real RFP excerpt.
- **Prisma on Windows:** the crew tables are accessed via raw SQL because the
  Prisma client can't be regenerated while the dev API holds the engine DLL.
  Apply the migration with `pnpm db:migrate`; regenerate the typed client
  between sessions to (optionally) move off raw SQL later.
- **NDA-D:** `kickoff()` documents the caller obligation — never feed Tier-D
  ("never-in-AI") content into crew inputs (mirror `isDocumentAiSafe`).

## Historical note

Auto-trigger the RFP Response Crew from document upload so it runs as part of
the existing BullMQ RFP orchestration (alongside / instead of the
requirement-extract → … → qa-review stages). Today the crew runs standalone
from the Agent Studio, which fully covers "build agents that answer each step."

## RFP pipeline auto-run

The BullMQ RFP orchestration now runs the CrewAI-style specialist pattern inside
the `legal_scan` gate before proposal compilation:

`Legal Counsel -> Finance Lead -> Marketing Strategist -> Presales Lead -> Bid Manager`

Each specialist receives the extracted RFP source plus the current proposal
draft. Their outputs are written to `rfp_orchestrations.config.reviewCrew` and
to the AI audit log, then the workflow continues to proposal compilation and QA
review. Agent Studio still lets admins seed, edit, and manually run crews.
