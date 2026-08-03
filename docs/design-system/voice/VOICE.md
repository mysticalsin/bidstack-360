# BidStack 360° — Voice & Tone Guide

**Version:** 1.0.0
**Last updated:** 2026-05-24
**Owner:** Design Curator (Agent #5)
**Review cadence:** Quarterly. File a PR against this doc — do not edit silently.

---

## 0. Why this matters

BidStack 360° is a **pre-sales / bid-management CRM for consulting teams** at Mantu — and for the named accounts (Apple, SAP, Sanofi, …) those teams pursue. Our users are bid managers, account directors, and the executives who review their work in a QBR slide ten minutes before the meeting.

These users do **not** want a friendly chatbot. They want a precision instrument that **tells them the truth in the fewest words possible** so they can keep selling. If the voice gets wrong, the product feels indie. If it gets right, the product feels like the calm hand of a senior colleague.

This guide is the single source of truth for every word that ships in the UI. When in doubt, default to the rules here. When breaking them, document why.

---

## 1. Five tone words

Every piece of copy in BidStack 360° must measurably express **all five** of these tones. If a sentence violates two, rewrite. If a sentence violates one and you keep it, add a comment explaining why.

### 1.1 Precise

**Definition.** Say the exact thing. Numbers, dates, entity names, and statuses are spelled out — never approximated, never softened.

- **Do:** "Pipeline value: €1,243,500 across 12 opportunities."
- **Don't:** "You've got a healthy pipeline going."

### 1.2 Confident

**Definition.** State facts and outcomes directly. No hedges, no "perhaps", no "you might want to consider."

- **Do:** "This lead has no contacts. Add one to start qualification."
- **Don't:** "You may possibly want to think about adding a contact, if that makes sense for your workflow."

### 1.3 Calm

**Definition.** Acknowledge problems without alarm. Errors describe what happened and what to do — never panic the reader.

- **Do:** "Lost connection to the server. Your changes are saved locally; we'll retry in 30 seconds."
- **Don't:** "Oops! Something went wrong! We're so sorry!"

### 1.4 Respectful

**Definition.** Assume the reader is intelligent, busy, and a professional. Never explain what they already know. Never apologize for their own actions.

- **Do:** "Discard 3 unsaved changes?"
- **Don't:** "Are you really, really sure you want to discard your work? You'll lose everything!"

### 1.5 Direct

**Definition.** Verb-first, active voice, second person. No marketing fluff, no qualifiers, no exclamation marks.

- **Do:** "Mark this opportunity as Won."
- **Don't:** "It's time to celebrate — let's get this opportunity marked as a win! 🎉"

---

## 2. Three audience archetypes

### 2.1 The Bidder (uses the product daily)

**Who.** Senior consultant or bid manager. 8–12 active opportunities at any time. Lives in opportunity detail pages, the pipeline view, and the activity timeline. Switches between BidStack, email, and Slack 200+ times per day.

**What they care about.**
- Speed. Every extra click costs them.
- Knowing what's changed since they last looked.
- Whether a deadline is real or padded.
- Not being interrupted by a notification that doesn't need them.

**Voice adapts.**
- **Density first.** Compact copy. The bidder reads 50 things in a minute; long sentences die unread.
- **Use jargon they own.** "RFP intake", "stage exit", "win plate" — these are precise, fast, and signal we know the work.
- **Don't explain the basics.** Never tooltip "An opportunity is a sales deal."
- **Surface what changed.** Prefer "Stage moved to Proposal · 2h ago" over "Recent activity on this opportunity."

### 2.2 The Manager (reviews dashboards weekly)

**Who.** Sales director or practice lead. Manages 3–8 bidders. Opens BidStack on Monday morning and Friday afternoon. Looks at the cockpit dashboard and the team report.

**What they care about.**
- Where the pipeline is leaking.
- Which deals are slipping.
- Whether a bidder is overloaded.
- A two-line answer they can paste into an email.

**Voice adapts.**
- **Lead with the headline number.** "€2.4M weighted pipeline, +12% WoW" before the supporting detail.
- **Explain the metric inline.** "Win rate: 34% (vs 28% prior quarter)" — context built into the number.
- **No raw queries.** Don't ask the manager to construct filters; show them the saved view.
- **Comparative framing.** Always show direction and delta, not just current value.

### 2.3 The Executive (sees QBR slides quarterly)

**Who.** GM, MD, or board member. Sees BidStack output only as an exported slide or shared screenshot. Never opens the app.

**What they care about.**
- The one-line narrative.
- Whether things are on track.
- Trust in the underlying numbers.

**Voice adapts.**
- **Headlines are sentences.** A KPI card title is "Pipeline grew 18% this quarter", not "Pipeline".
- **Footnote sources.** Every exported view shows "Generated <date> from <data source>" so the executive trusts it.
- **No abbreviations.** "Closed-Won" not "CW", "Quarter-to-Date" not "QTD" on exec-facing surfaces.
- **No CTA in exports.** Slides have no "Click here". They are read-only artifacts.

---

## 3. When the voice changes

The five tone words always apply. But the **emphasis** shifts based on context. Use this matrix:

| Context | Lead with | De-emphasize | Example |
|---|---|---|---|
| **Errors** | Empathy + recovery action | Confidence (acknowledge the friction) | "Can't reach the server. Retrying in 15 seconds…" |
| **Wins / completions** | Brief acknowledgement | Celebration (no exclamation marks) | "Opportunity marked as Won. Pipeline updated." |
| **Data / metrics** | Precision | Warmth (numbers do not need adjectives) | "12 leads · 4 qualified · 2 lost" |
| **Deadlines / SLAs** | Urgency without panic | Calm (preserve the directness) | "Due in 2 hours. 3 contacts not yet briefed." |
| **Onboarding / empty states** | Helpful + concrete next step | Density (more breathing room is fine) | "No leads yet. Connect a source or add one manually." |
| **Confirmations of destructive actions** | Plain English consequence | Brevity (must spell out what will be lost) | "Delete this opportunity? All 14 linked activities will also be removed. This can't be undone." |
| **AI-generated content** | Provenance ("AI-drafted") | Implied authorship (never let AI text look human-authored) | "Draft generated by Dust · Review before sending" |
| **Permission denied / RBAC** | What action is blocked + who to ask | Apology (the system is correct, not regretful) | "You don't have permission to delete opportunities. Ask an Admin." |

---

## 4. Ten phrases we say

These are the canonical BidStack 360° phrases. Reuse them — don't reinvent.

1. **"No leads yet."** — fresh-tenant empty state. Pairs with a CTA.
2. **"No leads match your filters."** — filtered-empty state. Differentiates from #1.
3. **"Saved."** — silent confirmation on autosave. Three letters. Period.
4. **"Saved. Pipeline updated."** — when an action has a downstream effect.
5. **"This can't be undone."** — destructive-action confirmation. Always paired with a count of what will be lost.
6. **"Retry."** — error-recovery button. One word. Always.
7. **"Ask an Admin."** — RBAC dead-end. Doesn't pretend the user can fix it.
8. **"Due in <duration>."** — deadline framing. Relative for <7 days, absolute beyond.
9. **"Last updated <duration> ago by <name>."** — provenance footer on every detail page.
10. **"Generated by Dust · Review before sending."** — AI provenance prefix. Never implied, always explicit.

---

## 5. Ten phrases we don't say

These break the voice. If you find them in a PR, rewrite.

1. **"Oops!"** — softens an error into a cartoon. Use "Something went wrong" or, better, name the actual failure.
2. **"Awesome!" / "Great!" / "Nice work!"** — celebratory filler. The action is the celebration; the copy doesn't need to applaud.
3. **"Please …"** — politeness padding. "Please enter your email" → "Enter your email". The button is the request.
4. **"We'd love to …"** — first-person-plural marketing voice. We are the system, not a brand.
5. **"It looks like …"** — hedging. Either it is or it isn't. If unsure, surface the uncertainty as data ("3 of 5 fields match"), not vibes.
6. **"Sorry, …"** — apology padding. The system has no feelings. Describe the situation and the fix.
7. **"Just a moment…"** — vague delay. Use "Loading…" or a specific cause if wait > 3s.
8. **"Sign in to continue your journey."** — marketing copy. Login is not a journey. It's authentication.
9. **"Are you sure?"** — empty confirmation. Always state what will happen if they confirm.
10. **"Click here to …"** — buried CTA. Link text describes the destination ("View invoice"), not the gesture.

---

## 6. Style mechanics

| Rule | Why | Example |
|---|---|---|
| **Sentence case in UI**, never Title Case | Title Case reads as a brochure | "Mark as won" not "Mark As Won" |
| **No Oxford comma** when items are short and clear | Density | "Leads, opportunities, contacts" |
| **Use Oxford comma** when items contain "and" themselves | Disambiguation | "Sales, marketing, and bid operations" |
| **Numbers > nine use digits**; one through nine spelled out | Reading speed at a glance | "9 leads", "12 leads" |
| **No emoji** in body copy | Enterprise context | Reserved for `Success_Empty_Inbox_Zero` celebration state only |
| **No exclamation marks** in body copy or buttons | Voice is calm, not enthusiastic | "Saved." not "Saved!" |
| **Ellipsis (…) is one character** `…`, not three periods | Typographic correctness | "Loading…" |
| **Em dash (—) for parenthetical breaks**, en dash (–) for ranges | Typography | "Saved — 2 minutes ago", "Q1–Q3" |
| **Percentages: digit + %**, no space | Density | "34%" not "34 %" |
| **Currency: symbol-first for default, code-suffixed for non-default** | Locale safety | "€12,000" (default EUR), "US$ 8,500" (non-default USD) |
| **Dates: relative under 7 days**, absolute beyond | Cognitive load | "2h ago", "12 May 2026" |
| **24-hour time for system timestamps, 12-hour for user-facing schedule** | Disambiguation | Log: "14:23:08 UTC"; Calendar: "2:23pm" |

---

## 7. Review checklist

Before shipping any new copy, run this checklist:

- [ ] Reads in ≤ 1 second at glance speed?
- [ ] States the fact / consequence / next action — not vibes?
- [ ] Uses second person ("you"), present tense, active voice?
- [ ] No exclamation marks, no emoji, no "Oops"?
- [ ] Numbers and entity names exact (not "a few" / "some")?
- [ ] If destructive: spells out the count of what will be lost + "This can't be undone"?
- [ ] If AI-generated: prefixed with provenance ("Drafted by Dust · …")?
- [ ] Passes the audience test — would the Bidder / Manager / Executive understand it without context?

If you can't tick all 8, rewrite. If you can tick all 8 and it still feels off — file an entry in `docs/solutions/` so the next person learns.
