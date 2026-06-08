# Apollo Company Intelligence Privacy-First Defaults

## Problem

Apollo account enrichment is valuable for bid and presales work, but a CRM can
accidentally drift from company intelligence into contact/prospecting behavior.
For BidStack, Tony's requirement is explicit: pull company data such as
firmographics, technologies, employee count, revenue, intent, hiring, funding,
expansion, and leadership movement, but do not pull or persist emails or phone
numbers.

## Solution

- Prefer company/account tools first: Apollo MCP `search_companies` and
  `get_company`, then REST organization enrichment only when MCP is unavailable
  and a domain is known.
- Default people-oriented tools to off:
  - `APOLLO_MCP_ENABLE_EXECUTIVE_SEARCH=false`
  - `APOLLO_API_ENABLE_PEOPLE_SEARCH=false`
  - Apollo People Enrichment is not used for account intelligence.
- Cross-check Apollo news/funding/expansion signals against a fixed public-news
  endpoint (`APOLLO_NEWS_CROSSCHECK_ENABLED=true` by default) so strategic
  account planning is not based on a single vendor payload.
- Treat Apollo credit behavior as plan/tool dependent. Do not label search as
  free in product copy or stored metadata unless Apollo contract evidence proves
  it for the configured workspace.
- Recursively strip Apollo payload keys containing email, phone, mobile, dial,
  or contact before writing raw provider metadata.
- Map Apollo company payloads into first-class account fields and strategic
  signals:
  - firmographics: industry, employees, revenue, founded year, domain, website
  - technologies: `technologies`, `current_technologies`,
    `organization_technologies`
  - intent: `intent_topics`, `buying_intent`, `intent_signals`
  - news/funding/expansion: `news`, `latest_news`, `press_releases`,
    `funding_events`, `expansion_signals`, `investment_signals`, plus public
    news cross-check articles
- Show the last Apollo sync and freshness in the account cockpit so users can
  decide whether the data is trustworthy.
- Queue Apollo verification from every successful company-enrichment write path,
  including sales/opportunity autopopulate. Do not queue when a fresh verified
  cache row is reused.
- Enforce weekly freshness by recomputing Apollo strategic-intel freshness from
  `lastSyncedAt` at read time and expiring local/Apollo company cache rows after
  seven days. Do not trust a previously stored `freshness: "fresh"` label as the
  durable source of truth.

## Verification

- `pnpm --filter @bidstack/shared build`
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts`
- `pnpm --filter @bidstack/shared test`
- `pnpm --filter @bidstack/api exec vitest run src/services/crm/company.service.test.ts`
- `pnpm --filter @bidstack/api exec vitest run src/services/crm/company-enrichment.service.test.ts`
- targeted ESLint on Apollo/account-intel files
- Browser smoke:
  - Settings > Integrations > AI & Agents shows Apollo account intelligence and
    safe defaults.
  - Account cockpit shows Apollo sync, tech stack, and News and funding rows.
