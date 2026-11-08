# Consulting partners (slice 15)

Which third-party consulting firms work with each client, and how we stand against each one, on the account page (`/companies/:id`) and the account cockpit (`/accounts/:id`). Our own group entities stay in the MSA "who works with them" panel; this is outside firms only.

## What the section shows

- One tile per firm: monogram, relationship tags (strategic partner, implementation, managed services, audit, advisory, engineering), domain chips (IT, engineering, digital, data, SAP, cloud, cyber, HEMA / pharma), strength (count and recency of evidence, half-life one year) and evidence count.
- For the selected firm: a radar and score table of us vs the firm on quality, price, speed and domain depth, plus relationship (our won and open deals vs the firm's engagements). Each dimension shows its evidence count. No evidence shows "No evidence", never a guess.
- Record (wins and losses against the firm), 1 to 3 cited angles, an evidence timeline, and the paged evidence list.

## Sources and terms

All public fetches go through the slice 12 polite client: `ACCOUNT_INTEL_USER_AGENT` (falls back to `SEC_USER_AGENT`) naming a contact, robots.txt checked per host, in-memory cache, at least 5.5 s between requests to one host. Unset User-Agent means no public fetch; our own records are still read. No logins, no LinkedIn, no people lookup, no phone numbers or emails. Excerpts strip email addresses and phone numbers.

| Source | Use | Terms |
|---|---|---|
| GDELT DOC 2.0 API | News naming the client, a firm and a relationship word (partner, selects, alliance, transformation) | Free, open; GDELT asks for at least 5 s between calls |
| Google News RSS search | The same query, plus a `site:` query on the firms' own domains for case studies and press releases | Public RSS feed, same use as the account watchdog; titles and links only, every item links to the publisher, low volume and cached |
| Company newsroom and IR posts (stored by slice 12) | Client announcements naming a firm | Already fetched under slice 12 rules; no new request |
| Account watchdog events (stored) | Major news naming a firm | Already stored; no new request |
| Our notes, meeting intel summaries, activities, filed emails, win/loss records, competitor insights, bid competitor fields | Incumbent, competing, client feedback, quality, price and speed remarks | Internal; shown only to users who can already read the record |

Public tenders and award notices: the repo has no stored award data yet (only Chile normalizers), so awards that name a supplier are a documented gap.

## Evidence

Every row stores firm, origin (public or internal), source, method (`keyword_match`, `record_field`, `llm_extract`, `fixture`), the URL or the internal record type and id, the date, the excerpt, and `inferred` when the link was derived by rules (for example a case study on the firm's own site without an explicit relationship word, or an LLM remark). Rows are replaced on rescan of the same key and pruned three years after fetch.

Firm detection is a deterministic alias matcher (word boundaries, short aliases case-sensitive, longest alias first). Default firms: KPMG, Deloitte, PwC, EY, Accenture, Capgemini, IBM Consulting, Sopra Steria, Alten, Akkodis, Capgemini Engineering (Altran), CGI, Atos (Eviden), McKinsey, BCG, Bain. Add more with `CONSULTING_PARTNER_FIRMS` (`Name|alias,alias|domain`), and the org's competitor profiles are added automatically.

`CONSULTING_PARTNERS_LLM=true` adds an LLM pass over internal records with no keyword remark, through the org LLM path. A remark is kept only when its quote is found verbatim in the excerpt and names the same firm.

## Access

- `GET /api/v1/companies/:id/consulting-partners` and `GET .../:partnerId/evidence` need `account-intel:read`; `POST .../refresh` needs `account-intel:write`. Company scope applies (404 outside it).
- Internal rows follow the record: meetings use the meeting visibility rule, notes and activities need `activities:read`, emails show to the mailbox owner or, when filed to a deal or contact, to `activities:read` holders (deal in scope). Unfiled mail is never scanned. Win/loss, bid and competitor rows need `opportunities:read` and the deal in scope.
- MCP and Jarvis tool `consulting_partners`: API keys get public evidence only; a Jarvis user also gets internal rows from records they authored, own or attended.

## Jobs and env

Queue `consulting-partners`: `refresh` (manual Refresh) and a daily `sweep` (retention, rescan of our records on accounts changed in the last day, and with `CONSULTING_PARTNERS_AUTO_REFRESH=true` a refresh of stale key and top accounts, capped by `CONSULTING_PARTNERS_SWEEP_LIMIT`). The summary endpoint only reads stored rows.

Demo: `db:seed` writes Sample partners for MAPFRE (KPMG advisory, Accenture IT), DNB Bank (EY audit, Sopra Steria IT) and MAHLE (Akkodis engineering), plus Sample notes with quality, price and speed remarks.
