# Twenty CRM Pattern Extraction — Research Notes

**Date:** 2026-05-24  
**Researcher:** W7-10 agent  
**Source:** https://github.com/twentyhq/twenty (AGPL-3.0)  
**Overlay reference:** `packages/twenty-bidstack/` (read-only; preserved verbatim from handoff)

> **AGPL compliance note.** No code was copied from Twenty. All patterns below are documented as architecture/UX concepts (non-copyrightable ideas). Any adaptation implemented in `apps/` is an independent re-implementation inspired by the concept, not a derivative of Twenty's source.

---

## 1. Workspace Architecture

### Twenty's approach
Twenty separates three layers:

- **CRM core** — standard objects (Person, Company, Opportunity, etc.) with well-typed GraphQL schema auto-generated from metadata decorators (`@WorkspaceEntity`, `@WorkspaceField`, `@WorkspaceRelation`).
- **Workspace metadata layer** — runtime object definitions stored in the DB (`object_metadata`, `field_metadata` tables). Operators can add objects/fields without touching code; the GraphQL schema is regenerated on boot.
- **Marketplace app layer** — TypeScript packages that plug into extension points (`ApplicationRegistration`: navigation, commands, record tabs, workflow actions, AI agents). See `packages/twenty-bidstack/src/front/BidStackApp.tsx`.

### Ours (BidStack 360°)
- Single Fastify/Prisma monolith; no metadata layer.
- Custom objects implemented in Wave 7 via `CustomObjectDef + CustomObjectRecord` (JSON-value store) — similar to Twenty's approach but without the auto-generated GraphQL or runtime schema introspection.
- No marketplace app layer; features are wired directly.

### Gap / recommendation
Twenty's `@WorkspaceField` decorator auto-generates list views, record pages, GraphQL type, and REST endpoint for any new object. We do none of this — our custom objects need manual API routes. **Worth pursuing at Twenty migration time; not worth backporting now** (would require a metadata-to-schema code-generation pipeline). **SKIP for this wave.**

---

## 2. Object Metadata System

### Twenty's approach
Decorators (`@WorkspaceField`, `@WorkspaceRelation`) on TypeScript classes define the "standard" shape. A separate `field_metadata` table holds workspace-specific overrides (added fields, renamed labels). The ORM (twenty-orm) unions the two at query time — standard objects get strong types; custom workspace additions get typed via generated GraphQL.

Screenshot reference: https://github.com/twentyhq/twenty/tree/main/packages/twenty-front/src/modules/object-metadata

### Ours
Wave 4-2 added `CustomFieldDefinition + CustomFieldValue` (EAV-style). Wave 7-2 added `CustomObjectDef + CustomObjectRecord`. Neither auto-generates UI or API routes.

### Adapt or skip
The architectural concept — "separate field definition from field storage so runtime schema changes don't require migrations" — is sound and we already partially implement it. **The specific Twenty mechanism (TypeScript decorator + ORM) is not worth copying.** Our EAV approach is sufficient for the near term. **SKIP.**

---

## 3. Activity Timeline UX

### Twenty's approach
Twenty renders activities (calls, emails, meetings, notes) as a unified chronological timeline under each record. Items are grouped by day. Each item is expandable to show full content. The `activities` module in `twenty-front/src/modules` handles this.

Screenshot reference: https://twenty.com (product page)

### Ours
`apps/web/src/components/cockpit/ActivityTimelineCard.tsx` covers a similar pattern — chronological list, per-account, filterable by type. Already well-implemented. No gap large enough to warrant an adaptation.

### Adapt or skip
**SKIP** — our timeline is functional. Potential improvement: group-by-day dividers (currently flat list). Low effort, low leverage. Deferred.

---

## 4. Kanban Board Interactions

### Twenty's approach
Twenty's `record-board` module (`packages/twenty-front/src/modules/object-record/record-board`) implements a full drag-and-drop kanban.

Key patterns (inferred from module structure):
- Columns = pipeline stages. Drag-and-drop via `record-drag` submodule.
- Optimistic update: card moves immediately to new column; API call fires in background; reverts on error.
- Column metadata (WIP limit, color, collapsed state) stored server-side per view.
- Mobile: horizontal scroll; tap-to-expand card; no drag (touch events stripped).

### Ours
`/pipeline` page — kanban already exists. Drag handled by `@hello-pangea/dnd`. Optimistic updates via `useStageMutation`. No WIP limit or column collapse yet.

### Adapt or skip
**SKIP for now.** Column-collapse is a nice polish item but not blocking. WIP limits need product decision. Our kanban is functional.

---

## 5. Command Bar (Cmd+K)

### Twenty's approach
`packages/twenty-front/src/modules/command-menu` — a two-tier palette:
1. **Navigation commands** — "Go to People", "Go to Settings > SSO" etc. Registered statically at app init.
2. **Record search** — live search across all object types; results show type badge + primary field.
3. **Contextual actions** — depends on which record page is open ("Create task for this opportunity", "Export to CSV").
4. **Recent items** — items visited in this session float to the top when the query is empty.

### Ours
`apps/web/src/components/command/CommandPalette.tsx` — already implements:
- Navigation (static `NAV_TARGETS` array with keyboard hints)
- Record search (accounts, contacts, tasks, opportunities, agents)
- Recent items (palette-recents + cockpit account-history)
- Agent launch

Gap: **contextual actions** (actions that change based on the currently open record page) are missing. Adding these would make the palette a true action hub.

### Adapt
**ADAPT (A3) — Command bar contextual actions.** Add a `useCommandContext` hook + a registration point so any page can push contextual actions into the palette while mounted. Low effort, high daily-use leverage.

---

## 6. Inline Editing Pattern

### Twenty's approach
`record-inline-cell` module: every table cell in a record list is click-to-edit. The cell renders a `ReadMode` (static label + subtle edit affordance on hover); clicking swaps to an `EditMode` (input, select, or custom editor). Saves on blur or Enter; Escape reverts. Optimistic update updates the React Query cache immediately; server confirms asynchronously.

### Ours
`apps/web/src/components/opportunity/InlineEdit.tsx` already ships `InlineEditText`, `InlineEditNumber`, `InlineEditDate`, `InlineEditSelect` — same click-to-edit / blur-to-save / Escape-to-cancel pattern as Twenty. The `OpportunitiesPage` already wraps table cells in these components.

Gap: **other list pages** (Contacts, Tasks, Leads, Companies) don't use `InlineEdit` yet — they link to a detail page for editing.

### Adapt
**ADAPT (A2) — Inline cell editing on Contacts and Leads list pages.** Wire the existing `InlineEdit` components into the contacts and leads tables so common fields (name, email, status) are editable in-place. Zero new infrastructure; just adopt the existing component.

---

## 7. Relation Field UX (Lookup Fields)

### Twenty's approach
`record-picker` module: when you assign a relation field (e.g. linking a Deal to a Company), Twenty shows a search-as-you-type dropdown. Features:
- Debounced backend search (triggers at ≥ 2 chars).
- Recent values shown when query is empty (session-scoped, not persisted).
- "Create new [Object]" inline option when no match found.
- Keyboard: Arrow/Enter to select, Escape to close, Tab moves to next field.

### Ours
Most relation inputs are plain `<select>` dropdowns loaded with all options (works fine at small scale but degrades at >100 records).

### Adapt
**ADAPT (A4) — LookupFieldPicker component.** Generic `<LookupFieldPicker>` with search-as-you-type, recent values, and create-inline affordance. Start with Company lookup (used in Opportunity form and Contact detail). High leverage when tenant data grows.

---

## 8. Workspace Member Presence

### Twenty's approach
Twenty shows "X is online" indicators in the sidebar and record pages. Implementation likely uses a Redis pub-sub heartbeat pattern (users send a heartbeat every 30s; the server publishes presence events via SSE/WS to all workspace members).

### Ours
Wave 7-3 added `UserPresence` model in the schema. SSE stream exists at `/api/presence`. Settings → Team section (`TeamSection.tsx`) lists members but doesn't show online status.

### Adapt
**ADAPT (A5) — Surface online status in Settings → Team page.** Wire the existing `UserPresence` SSE stream to the `TeamSection` component so the green dot / grey dot appears next to each member. The backend is already built; this is purely a frontend wiring task.

---

## 9. Filter + View Persistence

### Twenty's approach
`packages/twenty-front/src/modules/views` — the most distinctive Twenty pattern:

- **Saved views** are first-class DB records (`view` table). Each view stores: object type, filters (array of `{fieldId, operator, value}`), sort (field + direction), column visibility + widths, group-by field, and display name.
- A user can have multiple saved views per entity (e.g. "My open deals", "Enterprise Q3", "Won 2025").
- Views are user-scoped by default; can be shared to the whole workspace.
- The view picker (top-left of every list page) shows saved views + "Add view" button.
- Filters are shown as removable chips below the toolbar.
- URL search params are derived from the active view, not the source of truth — the DB is.

Screenshot reference: https://github.com/twentyhq/twenty/tree/main/packages/twenty-front/src/modules/views

### Ours
We use URL search params for ephemeral filter state (`?search=`, `?pipelineStageId=`). No persistence, no named views. This is a genuine gap.

### Adapt
**ADAPT (A1) — Saved views per entity.** This is the highest-leverage adaptation. Schema: `SavedView` model. API: CRUD routes. UI: `ViewPicker` + `ViewBar` components on the Opportunities list. **Implement MVP for Opportunities only; extend to other entities later.**

---

## 10. Form + Page Builder

### Twenty's approach
Twenty's layout customization (`layout-customization` module) lets admins drag-drop fields onto a record page without code. The page layout is stored in the metadata layer (per view, per object type). This is a no-code surface.

### Ours
Wave 4-3 added dashboard widgets (`WidgetRenderer`, `WidgetConfigModal`). We don't have a no-code record-page builder.

### Adapt or skip
**SKIP.** Building a no-code page builder would be a Wave 8+ project. Our custom-object records use a generic detail page. No immediate business need.

---

## Adaptation Summary

| # | Adaptation | Effort | Value | Decision |
|---|-----------|--------|-------|----------|
| A1 | Saved views per entity (Opportunities) | M (3–4 days) | High | **IMPLEMENT** |
| A2 | Inline editing on Contacts + Leads tables | S (1 day) | Medium | **IMPLEMENT** |
| A3 | Command bar contextual actions | S (1 day) | High | **IMPLEMENT** |
| A4 | LookupFieldPicker component | M (2 days) | High | **IMPLEMENT** |
| A5 | Online status in Team settings | XS (2h) | Medium | **IMPLEMENT** |

Skipped patterns: workspace metadata system, activity timeline (already good), kanban (already good), page builder (Wave 8+).

---

## AGPL Compliance Approach

All implementations in `apps/` are **independent re-implementations** of the conceptual patterns documented above. No source files from `twentyhq/twenty` were copied, adapted, or translated. The preservation overlay at `packages/twenty-bidstack/` is unchanged and excluded from the pnpm workspace per the existing `pnpm-workspace.yaml` rule.
