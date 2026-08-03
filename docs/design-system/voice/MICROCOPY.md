# BidStack 360° — Microcopy Pattern Guide

**Version:** 1.0.0
**Last updated:** 2026-05-24
**Owner:** Design Curator (Agent #5)
**Companion to:** `VOICE.md` (the why), `copy/buttons.json` + `copy/empty-states.json` (the registry)

Every UI surface in BidStack 360° pulls its copy from one of the patterns below. If a surface is not covered by a pattern, file a ticket and extend this document before shipping the copy.

---

## 1. Button labels

**Rules:**
- **Verb-first.** "Save", "Discard", "Add lead" — never "Click to save".
- **≤ 2 words** for the primary action. 3 words allowed for destructive variants that need a qualifier ("Delete permanently", "Discard changes").
- **Sentence case.** "Save changes" not "Save Changes".
- **No emoji, no exclamation marks.**
- **Disambiguate when verbs collide.** "Save" vs "Save changes" — see canonical table below.

### Canonical button label registry

The full registry lives in `copy/buttons.json`. The table below is the authoritative quick reference for the most common cases.

| Label | When to use | When NOT to use |
|---|---|---|
| **Save** | New record, no prior state to compare against | Editing existing record (use "Save changes") |
| **Save changes** | Editing existing record, dirty state | First-time save (use "Save"); autosave (no button) |
| **Save draft** | Multi-step wizard, intermediate persistence | Single-step form |
| **Update** | Replacing a value (e.g. status, owner) | Creating something new |
| **Apply** | Applying filters, view settings, bulk operations | Persisting a record |
| **Confirm** | Last step of a multi-step destructive flow | Single-step confirmation (use the specific verb: "Delete", "Discard") |
| **Cancel** | Closing a dialog without applying changes | After a destructive action runs (no take-backs) |
| **Close** | Dismissing a non-modal informational surface (drawer, panel, toast) | Modal that has unsaved changes (use "Discard" or "Cancel") |
| **Discard** | Throwing away one piece of unsaved work | Permanent deletion of saved data (use "Delete") |
| **Discard changes** | Throwing away multiple unsaved edits at once | Single change (use "Discard") |
| **Delete** | Removing a saved record | Removing a draft (use "Discard") |
| **Delete permanently** | Bypassing the soft-delete recycle bin | Soft delete (use "Delete") |
| **Remove** | Detaching a record from a relationship (e.g. remove contact from opportunity) | Deleting the underlying record (use "Delete") |
| **Add** | Creating a new related record from within a parent context | Top-level new-record creation (use "New <entity>") |
| **New lead** / **New opportunity** | Top-level creation entry-points | Inline relationship creation (use "Add") |
| **Send** | Email, message, or report dispatch | Form submission (use "Submit" or the specific verb) |
| **Submit** | Wizard final step | Any non-wizard form (use the specific verb: "Save", "Send", "Apply") |
| **Convert** | Lead → Opportunity transition | Stage progression (use "Move to <stage>") |
| **Retry** | Failed action that the user can re-trigger | Action that requires changes first (use "Try again with…") |
| **Back** | Wizard back-navigation, drawer back | Browser-history back (no button needed) |
| **Next** | Wizard forward-navigation when the next step's verb is unknown | Final wizard step (use specific verb: "Publish", "Send") |
| **Got it** | Acknowledging an informational dialog (no action required) | Anything with consequences (use the specific verb) |
| **I understand** | Acknowledging a destructive consequence in a 2-step destructive confirm | Routine confirmation (use "Confirm") |
| **Yes** / **No** | Binary question where both verbs are obvious from context | Anything else (use specific verbs) |

---

## 2. Empty states

**Structure:**

```
Title          ≤ 8 words, sentence case, no period
Body           ≤ 20 words, ends with a period
CTA (primary)  Verb-first, ≤ 3 words
CTA (optional) Secondary action link, ≤ 4 words
```

**Title patterns:**
- Fresh-tenant: **"No <entity> yet"** — implies the tenant is new, not broken.
- Filtered-empty: **"No <entity> match your filters"** — implies adjustable user state.
- Permission-blocked: **"You don't have access to <thing>"** — does not say "no data".
- Aspirational: **"Inbox zero — nice work"** — reserved, only for `Success_Empty_Inbox_Zero`.

### Worked examples

**Example 1 — Neutral (`NoLeadsYet`):**
```
Title:        No leads yet
Body:         Add a lead manually or connect a source to start prospecting.
CTA primary:  Add a lead          → /leads/new
CTA secondary: Connect a source   → /integrations
```

**Example 2 — Opportunity (`NoOpportunitiesYet`):**
```
Title:        No opportunities yet
Body:         Track your first bid to see pipeline metrics and forecasts here.
CTA primary:  New opportunity     → /opportunities/new
CTA secondary: Import from CSV    → /opportunities/import
```

**Example 3 — Error (`Error_Network`):**
```
Title:        Lost connection to the server
Body:         Your changes are saved locally. We'll retry in 30 seconds.
CTA primary:  Retry now           → triggers refetch
CTA secondary: Work offline       → dismisses banner
```

---

## 3. Confirmation copy — 3-tier pattern

The level of friction in a confirmation must match the consequence. We use three tiers.

### Tier 1 — Low stakes (one-step, soft confirmation)

For reversible actions: archive, unpin, dismiss notification, leave a draft.

**Template:**
```
Title:    <Verb> <thing>?
Body:     <One sentence describing what happens and how to reverse it.>
Buttons:  [Cancel] [<Verb>]
```

**Example:**
```
Title:    Archive this opportunity?
Body:     It will move to the Archive list. You can restore it any time.
Buttons:  [Cancel] [Archive]
```

### Tier 2 — Medium stakes (one-step, hard confirmation)

For destructive but recoverable actions: soft-delete, bulk-discard, end a session.

**Template:**
```
Title:    <Verb> <thing>?
Body:     <Sentence stating consequence>. <Sentence stating recoverability.>
Buttons:  [Cancel] [<Verb>]      ← destructive button uses --danger token
```

**Example:**
```
Title:    Delete this opportunity?
Body:     It will be moved to the recycle bin. You have 30 days to restore it before permanent deletion.
Buttons:  [Cancel] [Delete]
```

### Tier 3 — High stakes (two-step, irreversible)

For permanent destruction: hard-delete, drop integration with credentials, transfer ownership of an account.

**Template:**
```
Title:    <Verb> <thing> permanently?
Body:     <Sentence stating consequence and scope.> This can't be undone.
Confirm:  Type "<thing-name>" to confirm.   ← required input field
Buttons:  [Cancel] [<Verb> permanently]     ← stays disabled until input matches
```

**Example:**
```
Title:    Delete this account permanently?
Body:     All 47 linked opportunities, 23 contacts, and 184 activities will also be deleted. This can't be undone.
Confirm:  Type "Apple, Inc." to confirm.
Buttons:  [Cancel] [Delete permanently]
```

---

## 4. Toast copy — 4 patterns

Toasts are short, transient, and never carry information the user must read to proceed. If the information is mission-critical, use an inline alert or a modal instead.

| Pattern | Token | Length | Auto-dismiss | Action button? |
|---|---|---|---|---|
| **Success** | `--success` | ≤ 6 words for the title; body optional, ≤ 12 words | 2.4s default, 1.6s for trivial saves | Only if there's an undo (e.g. delete with restore) |
| **Error** | `--danger` | ≤ 8 words for the title; body required, ≤ 20 words and must describe the recovery | No auto-dismiss — user must dismiss | Always include the recovery action ("Retry", "View details") |
| **Warning** | `--warning` | ≤ 8 words for the title; body required, ≤ 16 words | 6s default | Optional; never destructive |
| **Info** | `--info` | ≤ 8 words; body optional | 4s default | Optional |

### Success examples
- `Saved.` (1.6s, no action)
- `Lead converted to opportunity.` (2.4s, no action)
- `Deleted "Acme Corp."` + `[Undo]` (4s, undo action)
- `Imported 24 contacts.` (2.4s, no action)

### Error examples
- `Could not save changes.` + body: `The server returned an error. Your changes are kept locally.` + `[Retry]`
- `Lost connection to Slack.` + body: `Notifications are paused. Reconnect from Integrations.` + `[Open Integrations]`

### Warning examples
- `Stage skipped two steps.` + body: `"Discovery → Proposal" bypasses Qualification. Confirm this is intentional.`

### Info examples
- `Dust agent is running.` + body: `Account intel will appear when it's ready.`

---

## 5. Form field labels

**Rules:**
- **Singular.** "Email", not "Emails" (unless the field accepts a list, e.g. "Email recipients").
- **No colon at the end.** The visual indentation does that job; a colon is double-marking.
- **Plain English.** "Company size" not "Headcount class enum".
- **Sentence case.** "Account owner" not "Account Owner".
- **Required marker is visual, not textual.** Use the asterisk + `aria-required`, not "(required)" in the label.

### 15 canonical CRM labels

| Label | Where it appears | Notes |
|---|---|---|
| **Email** | Contact create, login, intake | Never "Email address" — redundant |
| **Full name** | Contact create, signup | Singular field even though it's two words |
| **Phone** | Contact, account | Never "Telephone" or "Mobile" — use sub-label for type |
| **Account** | Opportunity, contact, lead | Never "Company" inside the app — we use "Account" consistently |
| **Owner** | Every record | Never "Assignee" or "Responsible party" |
| **Stage** | Opportunity | Never "Status" for opportunities — stages are sales-cycle positions |
| **Status** | Task, lead, activity | Reserved for non-opportunity entities |
| **Close date** | Opportunity | Never "Expected close" or "Forecast date" |
| **Source** | Lead | Never "Lead source" — context makes "Lead" redundant |
| **Value** | Opportunity, quote, invoice | Never "Amount" or "Deal size" |
| **Currency** | Anywhere money appears | ISO 4217 code only (EUR, USD, GBP) |
| **Probability** | Opportunity | Always a % — never "0–1 decimal" or "Confidence" |
| **Notes** | Every record | Plural — accepts multiple notes |
| **Tags** | Every record | Plural — accepts a list |
| **Due date** | Task, deadline | Never "Deadline" — too charged |

---

## 6. Form help text

**Rules:**
- **≤ 12 words.**
- **Useful, not redundant.** Don't say "Enter your email" under a label that already says "Email".
- **Show the example.** When format matters, show the format, not a description of the format.

### 5 do / don't pairs

| Field | Don't | Do |
|---|---|---|
| **Email** | "Enter a valid email address" | (no help text needed — error message handles invalid input) |
| **Phone** | "Enter your phone number with country code" | "Format: +33 6 12 34 56 78" |
| **Currency** | "Select the currency for this amount" | "Used in reports and exports" |
| **Probability** | "Enter the win probability as a number" | "0–100. Auto-suggested from stage." |
| **Close date** | "Pick the date you expect to close this deal" | "Used in forecast reports" |

---

## 7. Form error messages

**Rules:**
- **Specific + actionable.** Name the problem and the fix.
- **Position inline, below the field.**
- **Tone is calm and direct.** Not "Oops, that's invalid!" — describe what the system needs.
- **One message per field** at a time. If multiple errors exist, show the most-fixable first.

### 8 bad → good rewrites

| Case | Bad | Good |
|---|---|---|
| Empty required field | "This field is required." | "Email is required." |
| Invalid email format | "Invalid email" | "Enter a valid email address (e.g. name@company.com)." |
| Password too short | "Password too short" | "Password must be at least 12 characters." |
| Date in the past | "Date invalid" | "Close date must be today or later." |
| File too large | "Upload failed" | "File is larger than 25 MB. Compress it or split into parts." |
| Network failure on submit | "Error" | "Couldn't reach the server. Your input is kept — retry when you're back online." |
| Permission denied | "Forbidden" | "You don't have permission to edit this opportunity. Ask the owner or an Admin." |
| Server error 500 | "Something went wrong" | "Server error. We've logged it — try again in a minute." |

---

## 8. Loading messages

**Rules:**
- **"Loading…"** is the default for any wait < 3 seconds. No specifics needed.
- **Specific copy** kicks in only when wait > 3 seconds. The user has time to read.
- **Never lie about progress.** If you don't know % complete, don't show a percentage.
- **Never use "Just a moment…" or "Hang tight…"** — vague and infantilizing.

### 5 scenarios

| Scenario | Expected wait | Copy |
|---|---|---|
| Page route transition | < 1s | (skeleton only, no text) |
| Table page-load | < 2s | "Loading…" |
| AI draft generation | 3–10s | "Drafting with Dust… (≈10s)" |
| File upload | varies | "Uploading 1 of 4 — proposal.pdf (24%)" |
| Bulk import | minutes | "Importing 1,243 contacts… 412 done" |

---

## 9. Skeleton vs spinner

| Use **skeleton** when… | Use **spinner** when… |
|---|---|
| The shape of the content is known in advance (list rows, KPI cards, detail panels) | The shape is dynamic or unknown (modal opening, dropdown loading) |
| Loading is the page's first paint | Loading is in response to a user action mid-page |
| Wait is 200ms–3s | Wait is < 200ms (then no indicator) or > 3s (then add specific copy) |
| User is at "look" mode, not "act" mode | User is at "act" mode (clicked submit, waiting for result) |

**Never use both.** Pick one per surface.

---

## 10. Dates and times

**Relative format** (under 7 days):
- `30s ago`, `2m ago`, `1h ago`, `2d ago` — lowercase unit suffixes, no space.
- `in 3h`, `in 2d` — for future relatives.
- `just now` — for anything under 30 seconds.

**Absolute format** (7 days or more, or on exec-facing surfaces):
- Date only: `12 May 2026` — day first, month name not number.
- Date + time: `12 May 2026, 3:42pm` — comma between, lowercase am/pm, no space before.
- System timestamps (logs, audit): `2026-05-12 14:23:08 UTC` — ISO 8601 + zone.

**Range format:**
- Same year: `12 May – 18 May` (en dash, spaces).
- Different year: `12 May 2025 – 18 May 2026`.
- Same day: `9:00am – 5:00pm`.

**Rules:**
- **Tooltip the absolute** on every relative timestamp. The number shows "2h ago"; the tooltip says "12 May 2026, 3:42pm".
- **No "yesterday" or "tomorrow".** Use "1d ago" / "in 1d" — the user is scanning, not reading prose.
- **Executive exports use absolute only.** Relatives expire; the screenshot from Q1 still shows "2h ago" in Q3.

---

## 11. Numbers and counts

**Whole numbers:**
- Under 10: spell out — "9 leads".
- 10–999: digits with no separator — "247 leads".
- 1,000+: digits with comma separator (en-US) — "1,243 leads".
- Locale handles separator at format edge (M10 wires this).

**Abbreviation (large values):**
- Default: full precision — `1,243,500`.
- Compact mode (KPI tiles, badge counters, axis labels): `1.2K`, `1.24M`, `1.24B`.
- Compact threshold: only abbreviate when ≥ 10,000. Below that, the digits read fast.
- Always show the full precision on hover via tooltip.

**Pluralization:**
- Singular: `1 lead`.
- Plural: `0 leads`, `2 leads`, `247 leads`.
- Use the helper `pluralize(count, 'lead')` — never inline ternary in JSX (it forks i18n in M10).

**Zero is plural:** "0 leads", not "0 lead". (Matches en-US English plural rules.)

---

## 12. Currency

**Default currency rules:**
- Every workspace has a default currency (set in Settings → Workspace). All amounts in that currency render with the symbol only: `€12,000`.
- Non-default currencies render with the **ISO 4217 code suffix-positioned**: `US$ 8,500`, `£3,200 GBP` — the code disambiguates without forcing locale assumptions.
- Mixed-currency views (e.g. pipeline with deals in 3 currencies) always show the code even for the default.

**Symbol-vs-code:**

| Context | Format | Example |
|---|---|---|
| Single-currency view, default currency | Symbol-prefix | `€12,000` |
| Single-currency view, non-default | Symbol-prefix + code suffix | `US$ 8,500 USD` |
| Multi-currency view | Code suffix on every value | `12,000 EUR`, `8,500 USD` |
| Exports / executive surfaces | Always with code | `€12,000 EUR` |
| Inputs | Code visible on the field, symbol omitted | label: "Value (EUR)", input: `12000` |

**Display rules:**
- No decimals on whole amounts (`€12,000` not `€12,000.00`).
- Two decimals when amount has fractional part (`€12,000.50`).
- Negative is parenthesized in tables (`(€2,400)`), prefix-minused in body copy (`-€2,400`).
- Stored in micros (integer × 1e6) per project convention — formatting happens at the edge.

---

## 13. AI-generated content

Every piece of UI text that was generated by an AI agent must be **visibly prefixed** with provenance. Never let model output read as human-authored.

**Provenance prefix patterns:**
- `Drafted by Dust · ` — prefix to any AI-drafted body of text.
- `AI summary · ` — prefix to a model-generated summary.
- `AI-suggested` — badge for inline AI suggestions in forms.
- `Review before sending` — required suffix on any AI-drafted message ready to dispatch.

**Confidence display:**
- Show the model's confidence as a chip/badge: `High confidence`, `Medium confidence`, `Low confidence`.
- Never show raw probability ("0.78"). Bucket it: high (≥ 0.85), medium (0.6–0.85), low (< 0.6).

**Trust failure handling:**
- If the model could not generate (rate limit, error): `Dust isn't available right now. Try again or write manually.`
- Never auto-fill a field with low-confidence output without surfacing the chip.

---

## 14. Conflict notes — current codebase usage to standardize

A grep of `apps/web/src/` (worktree at this commit) surfaced these inconsistencies that this guide resolves:

1. **Empty-state title drift.** Found three patterns for the same archetype: `"No accounts yet"`, `"No accounts match your filters"`, `"No accounts found"`. This guide standardizes on **"No <entity> yet"** (fresh) and **"No <entity> match your filters"** (filtered). The `"found"` variant is deprecated.
2. **"Retry" vs "Try again" vs "Reload".** Codebase uses all three. This guide standardizes on **"Retry"** (one word). See `copy/buttons.json`.
3. **Toast vocab inconsistency.** Errors are written as both `"Could not save"` and `"Save failed"`. This guide standardizes on **"Could not <verb> <thing>"** — see §4.
4. **`+ New <entity>`.** The plus-sign-prefix pattern is informal and breaks at i18n. This guide standardizes on **"New <entity>"** with the icon supplied by the `<Button>` component, not the label.
5. **`No notes for this account.`** Conversational; reads as a sentence inside an empty-state body. This guide standardizes on title + body separation: **"No notes yet"** / **"Notes linked to this account appear here."**

These are not fixed by this milestone — M9 wires the eslint rule that catches button drift; the empty-state JSON in M4 is the source of truth for that surface.

---

## 15. Localization readiness

All copy in this document and the companion JSON files is **en-US baseline** for M10 catalog seed.

- Pluralization is rule-based (see §11) — M10 will swap to ICU MessageFormat.
- Date / time / number / currency formatting will route through `Intl` per locale in M10.
- Strings flagged `// i18n: ready` in JSON are stable enough to translate now.
- Strings flagged `// i18n: pending review` should not be translated until the next quarterly review of this doc.
