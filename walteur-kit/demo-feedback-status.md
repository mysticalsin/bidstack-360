# BitStack demo-feedback — implementation status (2026-06-13)

Source: Plaud "06-11 Présentation outil CRM/Avant-Vente BitStack". Scoped against
the live codebase by 5 subagents, then executed in verified waves on branch `demo`
(typecheck + lint + tests green, each pushed).

## BUILT THIS PASS (new/refined, verified + pushed)

| Item | What shipped |
|---|---|
| Per-user configurable account blocks (§1b) | `Customize` menu on the cockpit; 21 blocks toggle per-user (localStorage). The store existed but was dead-wired — now read by the render. |
| Contractual management (§1d) | `ContractAgreement` model + migration + API (CRUD, audited, org-scoped) + `ContractAgreementsCard`: MSAs/framework agreements, countries per MSA, global rebate (bps), rate-review schedule + next-review date. |
| Win/Loss reason capture + pattern flagging (§3) | `WinLossRecord` model + migration + API (upsert + index-backed patterns aggregate) + `WinLossReasonsCard`: capture a reason per closed deal; flags the dominant loss reason org-wide. |

## ALREADY DONE (verified present — no work needed)

Account External(Apollo)/Internal split + per-field source badges + override (§1a);
Signal Coverage 4-factor WHY + per-theme recommended action (§1c); Spotlight Ref
project references on accounts (§1f); Key vs Top accounts (§1g); Sector/vertical
view + FTE volumetrics (§2); Global Sales dashboard (§3); Win/Loss counts+rate (§3);
Cross-Sell section (§6); Comitology/governance tracking (§6); Bid/No-Bid scoring (§7);
Sales Toolkits in 360Learning/LMS (§7); InfoSearch + Leads (§5); DOS↔tool MCP (§5);
Webhooks (§5); access governance / group-mirrored permissions + detail-scope (§9b —
hardened this session); curated-integrations-only (§9c); Quotes/Products/Invoices
removed (§8).

## BLOCKED — needs a data source or a decision owner (NOT built; not faked)

| Item | Blocker |
|---|---|
| Revenue + revenue-evolution per client (§1e) | Not pullable from any connected system today (S1: "tu tires de nulle part"). Needs a sourcing decision. (Block renders behind `SHOW_REVENUE_BLOCK`, pipeline-derived as a stand-in.) |
| Sector: offer↔competency map, sectoral strength globally (§2) | Consultant data ~half wrong outside FR; sector classification quality unverified. Gate: clean/structured source. |
| Global dashboard: expertise-vs-solution filter + per-account % split (§3) | OM manages expertise vs solution differently; the filtering/sync rule must be defined (confirm with Arthur) before connecting. |
| ABC / Opportunity-Management API pull (§5) | Same expertise/solution rule must be defined first. |
| SAR-review PPT decks as a source (§5) | Requires a standardized cross-account doc storage format (dept AI-roadmap prerequisite). |
| Prospection capture (transcript/voice → accounts) (§4) | Decision pending: Tony prefers DOS/transcript→ABC (read-focused tool); others want in-tool capture. ~half of prospections have no transcript. |
| Action-plan management (§6) | Distinct from the audit trail (S1). Targeted V2, after the full bid process is in the tool. |
| Onboarding agent "Moha" (§7) | Adjacent initiative; connect to the LMS/toolkit piece. |
| RFP reading automation (§7) | Explicitly later phase; depends on structured storage of past proposals. |
| Contractual: "link to Red Cards" (§1d) | "Red Cards" is not a concept in the codebase yet. Deferred until the model/owner is defined. |

## CONSTRAINTS — status

- **Pre-sales piloting tool, NOT a CRM (§9a):** product framed as Bid/pre-sales; verify no residual "CRM" UI strings before the group demo.
- **Access governance (§9b):** M7 group-mirrored scoping + RBAC enforced; opportunity detail-by-id leak closed this session.
- **No open external firehose (§9d):** curated/validated integrations only.
- **Azure/security gate (§9e):** env-var config + infra/azure docs in place; **hard gate before real client data** = group Data + AI + Security validation (Jérôme / Clément Robin). Not yet done.
- **Scope discipline (§9f):** kept — built only what was verifiable; blocked items surfaced, not invented.

## NEXT DECISIONS FOR TONY

1. Define the **expertise-vs-solution OM rule** (unblocks the dashboard filter, per-account split, and the ABC/OM pull).
2. Pick the **revenue data source**.
3. Decide **where prospection capture lives** (DOS→ABC vs in-tool).
4. Confirm **"Red Cards"** meaning (is it `RiskRegisterItem`?) to wire the contract↔risk link.
5. Schedule the **group security validation** (the gate to beta).
