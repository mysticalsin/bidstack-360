# Sweep 15 — onboarding and first run

Walked a brand-new workspace on `main` `40b13242ebf18d715b67bb6133a9774bbd7d0c78` in a local build (web `http://127.0.0.1:38081`, API `http://127.0.0.1:4000`). The database had one synthetic org, Harbor Synthetic Co, one admin (Avery Founder), and zero companies, deals, contacts, leads, or tasks. No fixture seed. No customer data.

Score is "does a newcomer know the next move?" from 1 (lost) to 5 (obvious). Scores are the empty org on `main`, before the fixes below.

Not redone: #380 sample label, #414 and #446 install guide, #452 and #453 sample notice and won-this-year, #468 #469 #470 Add widget on mobile, #355 widget with no report (held), #418 Arabic, #485 ask list.

## Findings

| Sev | Finding | Where | PR | Head |
| --- | --- | --- | --- | --- |
| HIGH | Accounts invented a Mantu card (12,000 employees, 99% confidence, At risk) when the org had zero companies, and hid the create action under a zeroed portfolio cockpit | `buildCompanies` | [#494](https://github.com/mysticalsin/bidstack-360/pull/494) stacked on [#452](https://github.com/mysticalsin/bidstack-360/pull/452) | `1b1e730378c00159b1273a16432d748b99ab2595` |
| HIGH | Profile, security, and the top bar stayed on Jane Smith / jane@mantu.com after `/api/v1/me` had resolved Avery Founder | stub auth chrome | [#499](https://github.com/mysticalsin/bidstack-360/pull/499) | `45ccb4fc1b42678c6bd28ef71734376e845fdd6e` |
| MEDIUM | Data import asked for a CSV and never offered the columns Polo maps | Settings → Data import | [#497](https://github.com/mysticalsin/bidstack-360/pull/497) | `5932f82e340174fd103efd4b3b7fee9f9ed19391` |
| MEDIUM | An unset workspace id rendered as `mantu-presales` | Profile & Security, Workspace | [#501](https://github.com/mysticalsin/bidstack-360/pull/501) | `7108e0caccb785ff42c9d7b0f0a383a27190079a` |
| MEDIUM | Quick Start → Invite your team opened Access groups, which do not add a person | `/quick-start` | [#503](https://github.com/mysticalsin/bidstack-360/pull/503) | `366401937bd5228d332f235b81f15bb518ad15d5` |
| MEDIUM | Quick Start → Complete your profile promises a name, photo, and timezone. The screen shows identity and sign-in method, not those fields | `/quick-start` → `?tab=security` | — | — |
| MEDIUM | Integrations reported "4 of 16 providers healthy" from the default connector catalog, including connectors that were not probed | Settings → Integrations | — | — |
| LOW | Bid/No-Bid lets you rate all ten criteria with no opportunity selected. Save stays disabled, with no empty-state pointing at the first deal | `/bid-matrix` | — | — |
| LOW | The identity provider line still says "Dev stub (Jane Smith)" after the signed-in name is correct | Identity & roles | — | — |
| LOW | Proposals says both "No proposals yet" and "No results" | `/proposals` | — | — |
| LOW | Search on an empty org only says to type a keyword | `/search` | — | — |

There is no in-app "create an organization" step. Local stub auth binds to `org_seed_mantu`. A production org is `pnpm db:seed:prod` plus Clerk or Cloudflare Access. Install-guide gaps are #414 and #446. This sweep did not reopen them.

`GET /crm/dashboard` still builds a cockpit object with `fallbackCompany('Mantu')` when nothing is selected. After #494 that object is not in the company list, and `/accounts/mantu` 404s. The accounts page no longer shows it.

## Empty-org scores

| Page | Score | What a newcomer sees |
| --- | --- | --- |
| Dashboard | 4 | "Let's pilot your first bid" with add account, open opportunity, bid/no-bid, a template, and the checklist |
| Quick Start | 3 | Eight steps. Invite landed on the wrong tab (fixed in #503). Profile copy overpromises a photo and timezone |
| Accounts | 1 → 4 | Was a fake Mantu account. #494 shows "No accounts yet" with New account and CSV import |
| Companies | 4 | "No accounts on the radar", Add company, import CSV |
| Contacts | 4 | "Nobody in the buying group yet", Add first contact, import CSV |
| Leads | 4 | "The funnel is empty", New lead, import CSV |
| Opportunities | 4 | "No open bids yet", New opportunity, import CSV |
| Pipeline | 3 | "No opportunities yet" and a link to Opportunities |
| Tasks | 4 | "Nothing on the bid clock" and New task |
| Analytics | 3 | "No dashboards" and Create dashboard. Adding a widget with no report is #355 and was not touched |
| Proposals (RFPs) | 3 | New Proposal is there. The table also says "No results" |
| Bid/No-Bid | 2 | The matrix is editable before any opportunity exists |
| Integrations | 2 | A setup list exists, then "4 of 16 providers healthy" |
| Settings | 3 | The overview is dense but each control has an Open link. Workspace id and the signed-in name were wrong (#501, #499) |
| Forecasts | 3 | "No open pipeline to forecast" and New Forecast |
| Win/Loss | 4 | Says outcomes appear once a won or lost reason is recorded. The owner list showed Avery Founder, not a fixture |
| Workflows | 3 | "No workflows yet" and New workflow |
| Calendar | 3 | Empty week, New event |
| Workload | 3 | "No live bids on any desk" and a link to the pipeline |
| Territories | 3 | "No territories" and New territory |
| Search | 2 | "Type a keyword above" and nothing else |

## Screenshots

`*.png` is gitignored, so the shots are attached to this pull request and to each fix PR. They are the Harbor Synthetic walk:

- Accounts before and after #494
- Profile before and after #499
- CSV import before and after #497
- Workspace id after #501
- Invite landing on Identity & roles, #503

## Stacking

Only #494 shares files with an open PR. It merges `cursor/accounts-sample-notice-2258` and its base is that branch, stacked on #452. The other four fix PRs are independent of `main`.

#355, the analytics widget renderer, and the install guides were not edited.
