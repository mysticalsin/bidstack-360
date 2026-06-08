# Competitor Intelligence (grounded, cited)

Status: in progress (slice 1 — grounded core + schema). Owner: Claude (relay baton).

## Goal

Give bid teams competitor research — public win/loss, capability, positioning and
**actual award pricing** — that is **never invented** and **always carries a source**.
The user's mental model was "NotebookLM", but NotebookLM has no public research API;
this feature delivers the same grounded-with-citations outcome on infra we control.

## Non-negotiable: cite-or-omit (no hallucination)

The guarantee is **structural**, not a prompt instruction:

1. **Schema:** `CompetitorInsight.sourceUrl` is **NOT NULL**. An uncited insight
   cannot be persisted.
2. **Enforcement layer:** `enforceCitations()` (in `@bidstack/shared/competitor-intel`)
   drops any model finding whose `sourceUrl` is not in the set of documents we
   actually fetched this run. The LLM may only *extract from supplied sources*; it
   may never introduce a URL or a claim of its own.
3. **Provenance:** every insight stores `sourceUrl`, `sourceTitle`, `sourceSnippet`,
   `retrievedAt`, and `provider`. Pricing is shown only when a public source exists;
   otherwise the insight is reported as "not found / unverified", never guessed.

## Sources (public-only + gated uploads)

- **USASpending** (`api.usaspending.gov`) — real federal award amounts to a
  competitor, with a per-award source URL. Best public pricing source.
- **SEC EDGAR / Wikidata** — entity + public-company context (existing connectors).
- **SSRF-guarded web search** — candidate public pages fetched through
  `isPublicHostname` + http(s)-only `assertPublicHttpUrl`. Pluggable search provider
  (`COMPETITOR_SEARCH_PROVIDER`: tavily | exa | serpapi).
- **User-uploaded competitor docs** — only after passing the existing NDA/Tier-D
  confidentiality gate (`isDocumentAiSafe`) — same rule as the RFP pipeline.

## Scope

- **Standing `CompetitorProfile`** per org (name, aliases, domain) — reusable.
- **Per-RFP enrichment** — a research run may be scoped to an `opportunityId`;
  insights then surface on that bid's CompetitorInsight panel and feed win-themes.

## Architecture

```
CompetitorProfile (per org)
   └─ research run (BullMQ: competitor-research)
        ├─ buildUsaSpendingCompetitorInsights()   ← cited award pricing
        ├─ fetchGroundedDocuments(searchHits)     ← SSRF-guarded public fetch
        ├─ LLM extraction (json_object, provider fallback like RFP)
        └─ enforceCitations(findings, fetchedUrls) ← DROP uncited  ★ guarantee
   └─ CompetitorInsight[] (sourceUrl NOT NULL)
        └─ web: CompetitorInsight panel on the bid workspace
```

Cross-cutting pure logic lives in `@bidstack/shared/competitor-intel` so both the
API and the worker (which cannot import from `apps/api`) share one implementation.

## Slices

1. **Grounded core + schema** — DONE. `@bidstack/shared/competitor-intel`
   (cite-or-omit, USASpending connector, SSRF), Prisma models + migration, unit tests.
2. **Worker queue + API routes** — DONE. `competitor.research` BullMQ queue
   (`apps/worker/src/queues/competitor-research.ts`) with an IP-pinning research
   fetch (`apps/worker/src/lib/safe-research-fetch.ts`); API profile CRUD + research
   trigger + insights endpoints (`apps/api/src/routes/competitors.ts`). USASpending
   needs no key; web search runs only when a provider key is set.
3. **Web CompetitorInsight panel** — TODO. Cited list, Research action, all states,
   dark mode. Endpoints ready: `GET /api/v1/opportunities/:id/competitor-insights`,
   `GET/POST /api/v1/competitors`, `POST /api/v1/competitors/:id/research`.

## Environment (add to `.env.example`)

```
# Competitor research (optional). USASpending works with NONE of these.
COMPETITOR_SEARCH_PROVIDER=        # tavily (others are a clean extension point)
COMPETITOR_SEARCH_API_KEY=         # key for the chosen provider; web search is skipped if unset
DUST_COMPETITOR_AGENT_ID=          # optional Dust agent for extraction; falls back to RFP_LLM_PROVIDER
COMPETITOR_RESEARCH_UA=            # optional User-Agent for outbound research fetches
```

## Untrusted-content safety

Fetched competitor pages are UNTRUSTED. The extraction prompt wraps them via
`buildAgentUserMessage` (prompt-safety) so a malicious page cannot inject
instructions, and `enforceCitations` discards any finding that cites a page we
did not fetch — so prompt injection cannot fabricate a sourced claim.

## Hand-off (DB)

New models require `pnpm db:migrate` + `pnpm db:generate` (Windows Prisma DLL lock +
no DATABASE_URL in the agent shell — Tony runs these between sessions). Migration SQL
is shipped under `packages/db/prisma/migrations/`.
