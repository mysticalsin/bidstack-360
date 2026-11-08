# Open Source Tech Stack Detection

## Problem

Account pages showed a technology stack only when Apollo, Seamless or a person
had filled it in. Most accounts had nothing, and the refresh route reported the
`open_data` lane as a single opaque status. Teams could not tell what was
checked, what came back empty, or which source a technology came from.

## Solution

Every account now gets a technology stack from open, public sources first.
Apollo is a fallback, not the default.

### Lanes

All lanes are keyless and read organization-level public data only.

| Source id | Label | What it reads |
| --- | --- | --- |
| `open_data:dns` | DNS | MX, SPF and TXT verification records, NS, and a short list of CNAME probes on the primary domain |
| `open_data:ct` | Cert | Certificate transparency host names from crt.sh |
| `open_data:web` | Website | One public homepage request after robots.txt allows it |
| `open_data:jobs` | Jobs | Public job postings already stored by account intel |
| `open_data:github` | GitHub | Public repository languages, only when the homepage links a GitHub org |

- Code: `packages/shared/src/tech-stack/` (rules, matchers, snapshot merge) and
  `packages/shared/src/server/open-tech-stack.ts` (network detector).
- HTTP goes through `publicGet`: public http(s) only, a connect-time address
  check that refuses private, loopback and metadata ranges, manual redirects
  (at most 3, each hop checked again), a size cap, no cookies, no logins.
- The User-Agent comes from `ACCOUNT_INTEL_USER_AGENT` when it carries a
  contact URL or address, otherwise a fixed default that names the product.
- crt.sh is cached for 7 days per query, paced at one request every 5 seconds
  per process, and cooled down for 15 minutes after an outage.

### Storage and merge

- No migration. The snapshot lives at
  `CompanyEnrichment.providerMetadata.openTechStack` (version 1) and is written
  with one atomic `jsonb_set`, so concurrent Apollo or Seamless writes keep
  their keys.
- A lane that ran replaces its own items. A lane that failed or was skipped
  keeps what it found before, so an outage never erases earlier evidence.
- When no lane could run at all (network off, every lane down, and no stored
  job postings), the stored snapshot is kept as is, sample data included.
- Sample snapshots are dropped on the first real run.
- `company-enrichment.service` merges open data with manual, meeting notes,
  Apollo, Seamless and Tech Intel items. Nothing older is dropped.
- The Apollo worker now preserves every non-Apollo metadata key on update
  (`openTechStack`, `seamless`, `githubOrg`). Before this slice an Apollo run
  replaced the whole `providerMetadata` object.

### Apollo fallback

- Rule: queue Apollo organization enrichment only when open data found fewer
  than 5 distinct technologies AND Apollo is configured.
- Configured means `APOLLO_MCP_URL` plus `APOLLO_MCP_BEARER_TOKEN`, or
  `APOLLO_API_KEY` plus a known domain.
- Fallback jobs carry `orgOnly: true`. The worker then skips executive and
  people search even when the opt-in people flags are set. Organization data
  only.
- The decision is stored as `apolloFallback`: `queued`, `not_needed`,
  `not_configured` or `unavailable`, and the refresh route reports Apollo as
  `skipped` ("Not needed") when open data is enough.

### When it runs

- Synchronously from `POST /api/crm/companies/:key/technical-stack/refresh`,
  which now reports real per-lane status and counts.
- Queue `company-tech-detect`: a refresh on company create and on import, and
  a weekly sweep. The sweep walks org by org (tenant guard), refreshes stacks
  older than 7 days, is capped by `TECH_STACK_SWEEP_LIMIT` (default 500), runs
  at concurrency 1 with a 10 per minute limiter, and can be turned off with
  `TECH_STACK_WEEKLY_REFRESH=false`.
- `BIDSTACK_OPEN_ENRICHMENT_DISABLED=1` or `NODE_ENV=test` turns the network
  lanes off.

### UI

- `/accounts/:accountId` and `/companies/:id`: technologies grouped by
  category, a source chip per item (DNS, Cert, Website, Jobs, Apollo, Manual,
  Meeting notes) with confidence, and an evidence popover with the public
  record, the date seen, and a link when one exists.
- A Coverage line names lane counts, lanes that found nothing, lanes not
  checked and lanes that could not be reached, plus the last checked date and
  a Sample tag for demo data.
- Accounts list cards show the top 3 technologies with logos.

### Editing and multiple stacks

Companies often run more than one stack (a business unit, region or acquired
entity on a different platform). Each category carries an optional `stack`
name; no name means the main stack. The same category can appear in several
stacks without merging (`Cloud` in the main stack and `Cloud` in
`Oncology R&D` stay apart). Users with `companies:write` can add, rename and
remove technologies, categories and stacks from the company page (Edit on the
Technology stack card) or the account cockpit editor. Saves go through the
existing manual override (`PUT /crm/companies/:key/technical-stack`) and are
audited; detected technologies keep their source and confidence when kept.

### Agent tool

`company_tech_stack` (read, `companies:read`, org scoped) returns the merged
technologies with source, confidence and evidence, the coverage summary and
the Apollo decision. Jarvis and the MCP server pick it up from the shared
registry.

## Fingerprint licensing decision

`packages/shared/src/tech-stack/fingerprints.ts` holds about 120 curated rules
written for this repo and covered by the repo licence. No third-party
fingerprint set is vendored. The maintained community Wappalyzer fork is
GPL-3.0, and the older permissive snapshots have unclear provenance. A small
reviewed set of enterprise-relevant rules is easier to audit and keep honest.

## GAPS

Open data cannot see everything. These gaps are stated in the UI through the
Coverage line and are not papered over.

- **Internal systems.** ERP versions, on-prem systems, internal tools, contract
  values and licence counts have no public footprint. A company running SAP
  ECC on-prem may show nothing about SAP at all.
- **Tools without a public footprint.** Anything that never touches DNS, a
  certificate, the homepage or a public job post is invisible. Absence of a
  technology is not evidence that the company does not use it.
- **crt.sh reliability.** crt.sh is a free community service. It is often slow,
  times out on large domains, and goes down. Failures are reported as "Could
  not reach: Cert" and the previous Cert items are kept. Wildcard certificates
  hide SaaS tenant host names, so the Cert lane undercounts.
- **Bot protection.** Sites behind bot protection or a challenge page return
  401, 403 or 429, or an interstitial with no real markup. These are reported
  as failures, never retried around, and never bypassed. Single-page apps that
  render everything client side expose fewer signals.
- **robots.txt.** When robots.txt disallows the homepage, the Website lane is
  skipped and says so.
- **Job boards.** Only public postings already stored by account intel are
  read. Postings behind logins, on private applicant systems, or on networks
  that forbid scraping are out of scope.
- **GitHub.** Only runs when the homepage links a GitHub org. Most enterprises
  keep their code private, so this lane is usually empty.
- **Confidence.** Scores are rule weights combined across lanes, not
  probabilities from a trained model. DNS verification records can outlive a
  cancelled subscription.
- **When Apollo is needed.** For accounts where open lanes find fewer than 5
  technologies (bot protected sites, thin public footprint, holding companies
  with many brands), Apollo organization enrichment is the next step. It needs
  `APOLLO_MCP_URL` plus `APOLLO_MCP_BEARER_TOKEN`, or `APOLLO_API_KEY` plus a
  domain. Without it the Coverage line says Apollo is not set up.
- **Demo data.** Seeded stacks for the demo accounts are sample data, marked
  as such in records ("Sample: ...") and with a Sample tag in the UI. They
  carry no URLs.

## Verification

- `pnpm --filter @bidstack/shared exec vitest run src/tech-stack src/server/open-tech-stack.test.ts`
- `pnpm --filter @bidstack/api exec vitest run src/routes/crm/technical-stack-open-data.integration.test.ts`
  (needs Postgres): rich run, thin run with Apollo queued, no key, sample kept
  when nothing ran, idempotent retries, 400 or 414, 403 and cross-org 404.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-tech-detect.test.ts src/queues/company-enrich-apollo.test.ts`
- `pnpm --filter @bidstack/web exec vitest run src/components/company src/components/accounts`
- `pnpm --filter @bidstack/db exec vitest run src/seed-tech-stack.test.ts src/agent-tools/tech-stack.test.ts`
- `E2E_AUDIT=1 pnpm --filter @bidstack/web exec playwright test e2e/audit/tech-stack.audit.spec.ts --workers=1`:
  evidence chips open and close, refresh returns 5 open data lanes, the
  accounts list shows at most 3 technologies, and a layout matrix over 3
  routes, light and dark, 1440, 1024 and 390 px checks overflow, overlap,
  clipped text and text under 12px.
