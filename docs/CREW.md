# Crew - CrewAI-Style Multi-Agent Infrastructure

A TypeScript port of CrewAI's structure, integrated into the RFP section so the
team can build role-based AI agents that answer each step of a bid response:
legal, finance, marketing, presales, delivery, compliance, red-team QA, and bid
management.

> This is a port of the structure, not the Python code. CrewAI is Python;
> BidStack is Node/TypeScript. The downloaded CrewAI and Amaris orchestrator
> references are semantic references, not code copied into production.

## Why Infrastructure, Not A Tool

Admins manage the infrastructure; members use it.

| Capability                    | Admin | Member                        |
| ----------------------------- | ----- | ----------------------------- |
| Create / edit / delete agents | Yes   | No                            |
| Create / edit / delete crews  | Yes   | No                            |
| Load standard agents          | Yes   | No                            |
| Run a crew on an RFP          | Yes   | Yes                           |
| View a crew + run results     | Yes   | Yes, own runs; admins see all |

Enforced server-side on every mutation with `requireRole('admin')`; run reads
are owner-scoped. The Agent Studio UI hides admin controls from members as
defense-in-depth.

## Architecture

| Layer        | Where                                                             | What |
| ------------ | ----------------------------------------------------------------- | ---- |
| Kit          | `apps/worker/src/crew/`                                           | `Agent` / `Task` / `Crew` / `Process` types plus `kickoff()` with sequential context chaining and hierarchical manager consolidation. |
| Execution    | `apps/worker/src/crew/dust-executor.ts`                           | Shared RFP provider wrapper: direct LLM first, then Dust. Supports NVIDIA NIM, OpenAI, Cloudflare Workers AI, Claude, Kimi, OmniRoute, Gemma, and Dust. |
| Data         | `packages/db` (`crew_agents`, `crews`, `crew_tasks`, `crew_runs`) | Org-scoped raw SQL tables from migration `20260530010000_crew_infrastructure`. |
| Queue        | `apps/worker/src/queues/crew-run.ts`                              | Loads a crew, calls `kickoff`, then persists status, task results, and final output. |
| API          | `apps/api/src/routes/crew-agents.ts`, `crews.ts`                  | Admin-gated CRUD, member crew runs, and scoped run reads. |
| Seed         | `apps/api/src/lib/crew-standard.ts`                               | Amaris-style standard agents plus the default hierarchical RFP Response Crew. |
| UI           | `apps/web/src/pages/AgentStudioPage.tsx`                          | Agent Studio for authoring agents and running crews. |

## Standard Agents

The default set now follows the Amaris-style RFP/P&L orchestration:

- `Document Intelligence Engine`
- `Tender Strategy Analyst`
- `Compliance Officer`
- `Legal Counsel`
- `Finance Lead`
- `Presales Lead`
- `Marketing and Competitive Strategist`
- `Delivery and Operations Director`
- `Red Team QA Reviewer`
- `Bid Manager`

The default **RFP Response Crew** runs:

1. Ingestion and parsing.
2. Market intelligence.
3. Go/no-go governance.
4. Compliance and legal review.
5. Solution engineering.
6. Commercial and P&L modeling.
7. Win-theme synthesis.
8. Red-team QA.
9. Executive finalization.
10. Bid Manager consolidation.

## How To Use

1. Admin opens Agent Studio, then clicks **Load standard agents**. This seeds or
   refreshes the standard agents, standard crew, and standard task prompts.
2. Anyone with run access picks a crew, runs it on an RFP, and reviews each
   specialist output plus the final consolidated result.

## Provider Configuration

Set one direct provider for worker-based RFP and crew calls:

```env
RFP_LLM_PROVIDER=nim
NVIDIA_NIM_API_KEY=
NVIDIA_NIM_MODEL=deepseek-ai/deepseek-v4-pro
NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_NIM_ALLOW_CUSTOM_BASE_URL=false
NVIDIA_NIM_THINKING=false
```

Direct provider order is controlled by `RFP_LLM_PROVIDER`. If no direct provider
is configured, or if the direct provider fails, the executor falls back to Dust
when `DUST_API_KEY` and `DUST_WORKSPACE_ID` are configured. If neither direct
provider nor Dust is configured, agents return explicit fail-open placeholders
so the workflow continues but cannot be mistaken for real AI review.

`NVIDIA_NIM_BASE_URL` defaults to the official hosted endpoint. Custom NIM
base URLs are rejected unless `NVIDIA_NIM_ALLOW_CUSTOM_BASE_URL=true`, and must
be public HTTPS endpoints.

### Cloudflare Workers AI

Workers AI speaks the OpenAI-compatible `/chat/completions` shape, so it needs
no client changes — but its endpoint is **account-scoped**, which makes it the
one provider where a token alone is not enough:

```env
RFP_LLM_PROVIDER=cloudflare          # alias: workers-ai
CLOUDFLARE_API_TOKEN=                # a Workers AI (Read) token
CLOUDFLARE_ACCOUNT_ID=               # 32 hex chars — `wrangler whoami`
CLOUDFLARE_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct
# CLOUDFLARE_BASE_URL=               # optional: a full URL (e.g. an AI Gateway route)
# CLOUDFLARE_ALLOW_CUSTOM_BASE_URL=false
```

The account id is composed into
`https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1`. Supplying the token
without the account id resolves to **no provider** (not a broken one) so the
executor falls through to Dust / the deterministic placeholder rather than
firing a request at an empty URL. Hosts other than `api.cloudflare.com` and
`gateway.ai.cloudflare.com` are rejected unless
`CLOUDFLARE_ALLOW_CUSTOM_BASE_URL=true`.

**Pick the model on two axes: context window AND whether it reasons.**

1. *Context.* `document-extract.ts` sends up to 80,000 characters in a single
   prompt (~20–27k tokens), so Cloudflare's headline
   `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (24,000-token context) truncates a
   long RFP.
2. *Reasoning.* `glm-4.7-flash`, `qwen3-30b` and `nemotron-3-120b` emit a
   chain-of-thought into `message.reasoning` **before** `message.content`. Give
   them a small `max_tokens` and the budget goes entirely to the trace —
   `content` comes back `null`, which `completeChat` reports as "returned empty
   content". Measured against the live endpoint on 2026-08-17: glm-4.7-flash
   returned `content: null` at `max_tokens=16` and answered normally at 512.

The default is therefore `@cf/meta/llama-4-scout-17b-16e-instruct` — 131k
context, no reasoning preamble, ~1s, clean JSON under `response_format`. The
curated list with context windows and reasoning flags lives in
`packages/shared/src/llm-catalog/index.ts` and is what the Settings picker
renders. (This is also why the connectivity probe uses `maxTokens: 512`, not 16:
a 16-token probe reports a perfectly healthy reasoning model as dead.)

**Token gotcha (cost a full debugging session once):** a Cloudflare API token
can carry a Client IP Address Filter. Such a token returns 200 from the
developer's network and `401 {"errors":[{"code":10000}]}` from the deploy host,
with a byte-identical key. Verify from the deploy host's egress IP, not your
laptop — see `lessons/2026-08-14-cf-token-ip-filter-works-local-401-cloud.md`.
Provider error bodies are now included in the thrown message, so that response
is visible in the Settings → Integrations **Test** result instead of a bare
`HTTP 401`.

Per-org credentials (Settings → Integrations → AI & Agents → Model providers)
override the env for that org; the account id goes in the **Cloudflare account
ID** field.

Secrets must live in `.env` or the deployment secret manager. Only placeholders
belong in `.env.example` and docs.

## Operational Notes

- **NDA-D:** never feed "never-in-AI" content into crew inputs. Mirror the
  `isDocumentAiSafe` gate from the RFP extraction worker.
- **Windows Prisma:** crew tables are available through raw SQL because the
  generated Prisma client can be locked by a running API process on Windows.
- **RFP pipeline auto-run:** the BullMQ RFP pipeline runs the specialist review
  crew inside the `legal_scan` gate before proposal compilation:
  `Legal Counsel -> Finance Lead -> Marketing Strategist -> Presales Lead -> Bid Manager`.
  The outputs are stored in `rfp_orchestrations.config.reviewCrew` and AI audit logs.
