# Account intelligence (slice 12)

Where an account is heading: revenue, open jobs and hiring trend, major news, what the company publishes, investments, and a reverse-engineered investment plan from its filings, cross-referenced into one cited view on the account page.

## Why revenue and open jobs were often empty

1. The SEC EDGAR and ESEF scan (`runFinancialsScan`) was never scheduled. Its only caller was a one-off script. It now runs as a daily repeatable job in the `account-intel` queue (`FINANCIALS_SCAN_ENABLED=false` turns it off).
2. EDGAR rejects requests without a descriptive User-Agent. Without `SEC_USER_AGENT` (or `ACCOUNT_INTEL_USER_AGENT`) every EDGAR call failed.
3. LEI and SEC CIK were only set by `seed:signals`, which is not part of `db:seed`, and nothing matched them. Registries refresh now matches an LEI through GLEIF (exact legal name, unique match only, stored unconfirmed).
4. The tier gate paused General accounts. A manual Refresh on one account now bypasses the gate for that account.
5. Private companies file no XBRL. Brønnøysund (Norway) and recherche-entreprises (France) now add registry figures where published.
6. Apollo was the only source for jobs and the revenue fallback. It needs `APOLLO_API_KEY`, and refresh was manual unless `ENRICHMENT_AUTO_REFRESH=true`. Free public ATS job boards are now read directly.
7. In demo, sample periods were dropped and no postings were seeded. `db:seed` now writes sample intel for DNB Bank, MAHLE and MAPFRE, tagged Sample.

## Sources, terms and env vars

All fetches send `ACCOUNT_INTEL_USER_AGENT` (falls back to `SEC_USER_AGENT`), which must name a contact email. Unset means public fetches are skipped and the source shows Not configured. robots.txt is honoured for every host (a 5xx or unreachable robots.txt means do not fetch). Responses are cached in memory and requests to one host are spaced by `ACCOUNT_INTEL_MIN_GAP_MS` (default 1000). No logins, no LinkedIn, no personal data beyond what account-people already handles.

| Source | Use | Terms | Env |
|---|---|---|---|
| Greenhouse Job Board API | Open roles | Public GET endpoints, no key | none |
| Lever Postings API | Open roles | Public published postings | none |
| Ashby public Job Posting API | Open roles | Listed jobs only | none |
| Workable widget endpoint | Open roles | Published jobs only | none |
| SmartRecruiters Posting API | Open roles | Public postings | none |
| Recruitee Careers Site API | Open roles | Published offers | none |
| Personio XML feed | Open roles | Published positions | none |
| schema.org JobPosting JSON-LD | Open roles on the company careers page | robots.txt, on-domain only | none |
| TheirStack (optional, off) | Aggregated jobs | Licensed API | `ACCOUNT_INTEL_JOB_AGGREGATOR=theirstack`, `THEIRSTACK_API_KEY` |
| Adzuna (optional, off) | Aggregated jobs | Licensed API, attribution | `ACCOUNT_INTEL_JOB_AGGREGATOR=adzuna`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| Company RSS or Atom, news sitemap, IR feed | Company posts | robots.txt, on-domain only, last 2 years | none |
| SEC EDGAR (XBRL and 10-K or 20-F text) | Financials, statements | SEC fair access, 10 requests per second max | `SEC_USER_AGENT` |
| filings.xbrl.org (ESEF) | Financials, statements | Open data | none |
| Companies House | UK profile | Free API key | `COMPANIES_HOUSE_API_KEY` |
| Brønnøysund Register Centre | Norway registry and accounts | NLOD open licence | none |
| recherche-entreprises.api.gouv.fr | France registry and published finances | Licence Ouverte (Etalab) | none |
| GLEIF | LEI match | CC0 | none |
| OpenCorporates (optional) | Registry fallback | Token required, attribution | `OPENCORPORATES_API_TOKEN` |
| Apollo (existing) | Revenue range fallback, labelled | Licensed | `APOLLO_API_KEY` |

Other env: `ACCOUNT_INTEL_AUTO_REFRESH=true` queues a daily refresh of key and top accounts (default off, refresh is manual), `ACCOUNT_INTEL_SWEEP_LIMIT` caps that sweep (default 25).

## Evidence ledger

Every fact stores its source URL, fetched date and the excerpt it came from (`IntelEvidence`, `CompanyPost`, `CompanyJobPosting`, `AccountFinancialPeriod`). Direction claims and investment lines cite evidence ids, and the read model drops any line whose evidence does not resolve. Derived lines carry basis `inferred`. Filing-text statements come from the LLM only when the returned sentence is found verbatim in the section; otherwise a rules extractor runs. Each statement cites its section.

## API, MCP, UI

- `GET /api/v1/companies/:id/intel/{direction,hiring,financials,news}` with `account-intel:read`. `POST /api/v1/companies/:id/intel/refresh` `{ source: hiring | posts | financials | registry }` with `account-intel:write`, returns 202 and never blocks. Org and access scope enforced (miss is 404), rate limited, audited.
- MCP read tools: `account_direction`, `account_hiring`, `account_financials_summary`, `account_news` (scope `read`, lists capped at 50, markup stripped).
- Account page section "Where they're heading": Direction, Hiring, Financials, News and posts, with a per-source strip showing status, last fetch, result and Refresh.

## Tenancy and retention

All tables carry `orgId` and every query filters by it. Job board postings not seen for 180 days and company posts or evidence older than 3 years are pruned by the sweep. Run status (`IntelSourceRun`) keeps one row per account and source. Sample rows (`source = 'fixture'`, `sample = true`) are only written by `db:seed`.

## Companies list intel (slice 14)

Why the list showed only employee count: `GET /companies` selected Company columns only, the slice 12 section was mounted on the Dashboard cockpit but not the account page, imports created companies without queuing any enrichment, Apollo funding and founded year were not mapped, and the demo seed covered 3 of 10 companies with no firmographics.

- Summary store: `company_intel_summaries`, one row per company, rebuilt after every intel refresh, enrichment run and full refresh (`recomputeCompanyIntelSummary`). Indexed columns drive the list filters; the JSON payload carries every metric with `source`, `sourceLabel`, `asOf`, `method`, `inferred` and `sample`, plus a reason (`not_connected`, `private_company`, `no_public_data`) for each empty field.
- Revenue: filings and registries first (SEC EDGAR, ESEF, Brreg, recherche-entreprises, imports), with fiscal year and currency; the Apollo estimate or range is a labelled fallback. Revenue growth is derived from two consecutive filed years and marked inferred. USD equivalents for filtering use a fixed rate table and are approximate.
- Headcount: Apollo organization estimate, then filed headcount, then the CRM record. Headcount growth is Apollo 6m (or 12m), else filed headcount year over year (inferred).
- Hiring: open roles (seen in 45 days), new postings in the last 30 days as the hiring proxy with the prior 30 days, 30 and 90 day trend, six month series, function mix and skills, from public job boards only. Never presented as hires.
- Direction: growing, steady or contracting from headcount change, filed revenue change, posting trend and recent layoffs, expansion or acquisition posts; always inferred, with the reasons.
- Apollo: `organizations/enrich` by domain only, behind `APOLLO_API_KEY`, inside `APOLLO_MONTHLY_CREDIT_BUDGET` (or `ENRICHMENT_MONTHLY_CREDIT_BUDGET`), job pages off on this path. Funding total, latest round and date, founded year, departments and technologies are mapped. No people, contact, email or phone endpoint is called and no such field is stored; tests pin both.
- Full refresh: `account-intel.full-refresh` job (manual Refresh on the account page, `POST /companies/:id/intel/refresh-all`, or an import) runs every public source, then Apollo organization data, then the summary. Manual Refresh forces the public sources only; Apollo keeps its own freshness window so a click does not spend a credit on fresh data. Import jobs never call the paid job aggregator (`ACCOUNT_INTEL_JOB_AGGREGATOR`).
- Imports: each CSV or HubSpot chunk queues one full refresh per new company and joins an `intel_import_batches` row per migration job. Retries merge ids and reuse job ids, so nothing is queued twice. The Companies page shows the batch while it runs and the result counts when it completes (`GET /companies/intel-imports`). `ACCOUNT_INTEL_IMPORT_ENRICH=false` turns it off. Batches older than 90 days are pruned by the sweep.
- List API: `GET /companies` items carry `intel` (or null) for callers with `account-intel:read`; without it the intel and its filters are dropped. Filters: `view` (`hiring_fast`, `revenue_over_1b`, `contracting`), `direction`, `minRevenueUsd`, `minNewRoles30d`. `GET /companies/:id/intel/summary` returns one summary.
- Demo seed: sample organization data and postings for every demo company, all tagged as sample data.
