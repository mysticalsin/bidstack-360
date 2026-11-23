# Sprint 1 — User Stories (Story Writer Phase)

**Sprint:** Krayin gap-import Sprint 1 (Tags + EmailTemplate + Lead Kanban + Rotten Days)
**Date:** 2026-05-27
**Phase:** Story Writer — no code, no schema, no API surface. User-facing behaviour and acceptance criteria only.
**Checkpoint:** Human approval required before Spec Writer phase ([CLAUDE.md §2](../CLAUDE.md)).
**Source brief:** [krayin-gap-analysis.md](./krayin-gap-analysis.md) §9 "Do now"

---

## Story 1 — Tags (with AI auto-tagging)

> **As a** bid manager juggling 40+ open opportunities,
> **I want** to tag any record (Lead, Account, Contact, Opportunity, Bid, Activity, Task) with one or more short labels,
> **so that** I can find related work in seconds, drive workflow rules off tag conditions, and let an AI agent surface patterns I'd otherwise miss.

### Acceptance criteria

| #       | Behaviour                                                                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1.1  | I can create a tag with a name (1–32 chars) and a colour from a fixed palette of 12 WCAG-AA-compliant choices.                                                                                              |
| AC-1.2  | I can apply or remove one or more tags inline on any taggable record without leaving the record view. Save is immediate (no separate "Save" click).                                                         |
| AC-1.3  | Tag chips appear on the record's header AND in list/grid rows AND in kanban cards. Same `<TagChip />` everywhere.                                                                                           |
| AC-1.4  | I can filter any list view by tag (AND across multiple selected tags). Filter persists in saved views.                                                                                                      |
| AC-1.5  | I can use `has tag X` / `does not have tag X` as a Workflow condition, and `add tag X` / `remove tag X` as Workflow actions.                                                                                |
| AC-1.6  | An AI agent (Dust) suggests 1–3 candidate tags on Lead/Opportunity creation, based on the record's text content (name, description, account industry). Suggestions are one-click apply, never auto-applied. |
| AC-1.7  | Tags are tenant-scoped: I can never see or apply another tenant's tags.                                                                                                                                     |
| AC-1.8  | I can rename a tag — the change is reflected on every record that uses it.                                                                                                                                  |
| AC-1.9  | I can delete a tag — the system asks "this tag is used on N records, remove from all?" and only proceeds with explicit confirmation.                                                                        |
| AC-1.10 | Tag chip is 44×44 px effective touch target (per [code-quality.md](../.claude/rules/code-quality.md)) and announces "<tagname>, tag" to screen readers.                                                     |

### Edge cases

- Two users attempt to create the same tag name simultaneously → one succeeds, the other gets the existing tag (no duplicate).
- Tag name with leading/trailing whitespace → trimmed on save.
- Tag with no records using it → still visible in the tag library; not auto-deleted.
- Lots of tags on one record (>10) → chips wrap to next line with no horizontal scroll.
- Filtering by tag with 0 matching records → empty state explains "No records have all selected tags" with a "clear filter" CTA.
- Agent's suggested tag matches an existing tag (case-insensitive) → suggest the existing one rather than creating a duplicate.

### Out of scope (explicitly)

- Hierarchical/nested tags (sub-tags). Krayin doesn't have these either.
- Per-user private tags. Tags are tenant-shared. Revisit if a real demand surfaces.
- Tag groups or namespaces.
- Bulk apply-tag from the agent (only one-click suggestions, no autonomous tagging).
- Tag analytics ("tag X correlates with 73% win rate") — that's a separate sprint.

### Open questions for the human checkpoint

1. **Colour palette source of truth.** Should the 12 tag colours come from existing design tokens, or do we introduce a new `--tag-{n}` set?
2. **Tag visibility on dashboards.** Should tags surface on the main Dashboard / Workspace Command Center, or only on list views?
3. **Agent confidence threshold.** Should the agent show suggestions for any tag it considers, or only those above some confidence floor?

---

## Story 2 — EmailTemplate (with AI draft-from-wins)

> **As a** sales rep sending follow-ups to 20 prospects a day,
> **I want** to pick a saved email template, see it auto-filled with the current record's details, and send it,
> **so that** I send on-brand consistent comms in seconds and the workflow engine can fire pre-approved emails on triggers.

### Acceptance criteria

| #      | Behaviour                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-2.1 | I can create an email template with a Name (1–80 chars), Subject (1–200 chars), and Body (rich-text up to ~10k chars).                                                                                                                                 |
| AC-2.2 | I can use placeholders like `{{lead.name}}`, `{{account.industry}}`, `{{user.firstName}}`, `{{deal.amount}}` in subject and body. A palette of available placeholders is shown alongside the editor.                                                   |
| AC-2.3 | I can preview the template with a sample record selected (Lead, Account, Opportunity, or Contact). Missing placeholder values render as `[—]` and are flagged before send.                                                                             |
| AC-2.4 | I can pick a template when composing an email from a Lead, Contact, Opportunity, or Account record. Placeholders fill from that record's context.                                                                                                      |
| AC-2.5 | The existing `send_email` workflow action accepts a Template ID instead of free-form body. Existing free-form bodies continue to work (backwards-compatible).                                                                                          |
| AC-2.6 | An AI agent (Dust) can suggest "Draft a template from this thread" or "Draft from past wins" — agent reads recent won-deal email threads from the same tenant + similar account profile and proposes a template. Suggestion is reviewed before saving. |
| AC-2.7 | Templates are tenant-scoped and shared across all users in the tenant.                                                                                                                                                                                 |
| AC-2.8 | I can mark a template as "archived" — it stops appearing in pickers but isn't deleted, so historical workflows that reference it still work.                                                                                                           |
| AC-2.9 | Template list view in Settings has search-by-name, sort-by-recent-use, and a "duplicate" action per row.                                                                                                                                               |

### Edge cases

- Placeholder references a field the record doesn't have (e.g., `{{lead.company}}` on a Contact-only record) → renders `[—]`, send is blocked with an inline warning. The rep sees what's missing before clicking Send.
- Template body contains HTML that fails the sanitizer → save is blocked with a specific error pointing at the offending tag.
- Rep edits the template body after applying it to a draft → those edits are NOT saved back to the template (they only affect this one send).
- Workflow action fires using an archived template → use the archived version (don't fail) but log a warning.
- Locale-specific placeholders (e.g., currency formatting) → respect the user's locale at render time, not the template author's.

### Out of scope (explicitly)

- Drag-drop visual email designer. Markdown + a small rich-text bar is enough for Sprint 1.
- A/B testing of templates.
- Per-template send-time analytics.
- Multi-language template variants (one template, one locale-aware render).
- Inline attachments stored on the template itself.

### Open questions for the human checkpoint

1. **Placeholder source of truth.** Does the placeholder catalog live in [packages/shared/src/schemas](../packages/shared/src/schemas/) so both API and Web compile against it, or in a runtime config?
2. **Rich-text editor.** Reuse the existing editor (whatever the Activity-Notes UI uses) or pick a new one? (Spec Writer will resolve based on current stack.)
3. **Agent draft-from-wins scope.** Should the "past wins" sample size cap at the last 90 days, last N deals, or "everything in the tenant"?

---

## Story 3 — Lead Kanban + Rotten Days

> **As a** sales rep with 80 leads in flight across 6 stages,
> **I want** to switch the Leads list to a kanban board grouped by pipeline stage and see at-a-glance which leads are going stale,
> **so that** I never let a hot lead go cold and I can take action on the ones the agent flags for recovery.

### Acceptance criteria

| #       | Behaviour                                                                                                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-3.1  | The Leads page has a view-switcher (List ↔ Kanban) in the top-right toolbar. The choice persists per-user across sessions.                                                                                                                           |
| AC-3.2  | In Kanban view, columns map 1:1 to the current Pipeline's stages. Drag a card to a different column to change stage. Drag emits the same audit log as a stage change via the list view.                                                              |
| AC-3.3  | Each kanban card shows: Lead name, Account name, Owner avatar, age, current stage's "Rotten Days" countdown if past threshold.                                                                                                                       |
| AC-3.4  | Each Pipeline has a per-stage `rottenDays` setting (integer, 0–365). When a Lead sits in a stage longer than that, the card shows a red "Rot 🥀" badge with the day count over threshold.                                                            |
| AC-3.5  | Hovering or focusing the rot badge reveals an AI-suggested "recovery play": one of (a) "Send re-engagement email" with a template suggestion, (b) "Schedule a call", (c) "Add to nurture sequence", or (d) "Mark as lost" with a lost_reason picker. |
| AC-3.6  | The recovery play is a one-click action that opens the corresponding flow with the lead pre-filled — never autonomously executed.                                                                                                                    |
| AC-3.7  | I can filter the board by tag (depends on Story 1), owner, source.                                                                                                                                                                                   |
| AC-3.8  | Drag handles meet 44×44 px touch-target rule. Keyboard users can move a card via menu (`Move to → [stage]`). The board is fully keyboard-navigable.                                                                                                  |
| AC-3.9  | Empty pipeline / empty stage shows a friendly empty state ("No leads in {stage} yet — drag one here or create new").                                                                                                                                 |
| AC-3.10 | Performance: board renders within 200ms INP target for pipelines up to 500 leads. Beyond that, columns virtualise.                                                                                                                                   |

### Edge cases

- Lead has no stage (orphan) → renders in a "Backlog / Unstaged" column at the far left, only visible if non-empty.
- Pipeline has 12+ stages → board scrolls horizontally without losing the column headers.
- User drags a card to a stage they don't have permission to set → drop is rejected with a toast explaining why. Card returns to its original column.
- The agent's recovery play uses a template that's been archived → fall back to a generic template and log the miss.
- Rot threshold of 0 days → every card past first heartbeat shows the rot badge (useful for "stale pipeline cleanup" sprints).
- Lead lacks last-activity timestamp → don't show rot until the first activity exists; show a separate "untouched" icon instead.

### Out of scope (explicitly)

- Forecasting based on rot rate (model: "this lead will go cold in 4 days") — separate sprint.
- Bulk drag (selecting multiple cards and moving them together).
- Re-ordering cards within a column (manual sort). Cards always sort by most-recent-activity desc.
- A separate kanban for Opportunities or Deals in this sprint. We extend the same primitive to those in Sprint 2.
- Mobile kanban view — list view stays the default on small screens; kanban is desktop-only for Sprint 1.

### Open questions for the human checkpoint

1. **`rottenDays` per stage vs per pipeline.** Krayin sets it per pipeline. Spec proposal: per-stage (different stages tolerate different staleness). Confirm.
2. **"Activity" definition for rot.** Does any activity (note, call, email) reset the clock, or only outbound activities? Krayin counts any. Proposal: any.
3. **Recovery play personalisation.** Should the agent learn from which plays each user actually clicks (per-user model) or stay rule-based for Sprint 1? Proposal: rule-based now, learning later.

---

## Cross-story dependencies

- Story 3 AC-3.7 (filter by tag) depends on **Story 1** Tag entity existing. Story 1 ships first OR concurrently and merges before Story 3's filter work.
- Story 3 AC-3.5 (recovery play with template suggestion) depends on **Story 2** EmailTemplate existing. Same constraint.
- Both Stories 2 and 3 use the agent overlay pattern (Dust). Spec Writer should confirm one common interface for "agent suggests N candidates, user one-click applies" rather than three separate patterns.

## What's NOT in any of the three stories

These three stories collectively do NOT touch:

- Quote PDF export (Sprint 2)
- Inbound email pipeline (Sprint 2 — the big AI feature)
- Web-to-Lead form builder (Sprint 2)
- Lost-reason analytics (Sprint 2)
- Krayin's permissions or warehouse modules (skip outright)

## Checkpoint — please review

Per [CLAUDE.md §2](../CLAUDE.md), I need your approval on the user stories before I move to Spec Writer (which converts these into technical briefs: schema changes, API surface, UI screens, test plan).

What to look for in this review:

- **Is the user behaviour right?** Wrong intent here corrupts everything downstream.
- **Are the acceptance criteria checkable?** Each AC should be a test the Validator can run.
- **Are the out-of-scope items correctly excluded?** If something belongs in Sprint 1 that I cut, say so.
- **Open questions** — pick answers where you have an opinion, defer the rest to Spec Writer.
