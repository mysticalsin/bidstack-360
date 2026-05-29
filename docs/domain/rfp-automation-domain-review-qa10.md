# QA-10 Domain Expert Review — Wave 9 RFP Automation Engine

**Reviewer role:** QA-10, Bid Process Domain Expert  
**Review date:** 2026-05-28  
**Branch:** feat/wave9-rfp-engine  
**Scope:** Read-only review against enterprise consulting / IT services bid management practice  
**Constraint:** No code was modified.

---

## 1. Scope Coverage Against the Operating Model

`docs/RFP_RESPONSE_OPERATING_MODEL.md` defines a 13-step enterprise RFP process. Wave 9 automates approximately steps 2–4 and partial 10–12.

| Step | Description                            | Wave 9 coverage   |
| ---- | -------------------------------------- | ----------------- |
| 1    | Bid / no-bid qualification             | Not present       |
| 2    | Document ingestion & text extraction   | Covered           |
| 3    | Requirement extraction                 | Covered           |
| 4    | Requirement embedding & story matching | Covered           |
| 5    | Red-flag / risk review                 | Not present       |
| 6    | Solution strategy                      | Not present       |
| 7    | Pricing review                         | Not present       |
| 8    | Legal review                           | Not present       |
| 9    | Security review                        | Not present       |
| 10   | Compliance matrix auto-fill            | Covered           |
| 11   | Section drafting                       | Covered           |
| 12   | Human approval gate                    | Partially covered |
| 13   | Submission readiness / post-submission | Not present       |

Eight of thirteen steps are absent. The automation covers the intake-and-draft corridor; everything that determines whether to bid, how to price, and whether the output is safe to send remains entirely manual.

---

## 2. Area Ratings

### 2.1 Document Ingestion and Requirement Extraction — GAP

**What works:**

- MIME validation (PDF, DOCX, PPTX) and 50 MiB limit are appropriate.
- NDA-D gate blocks all AI calls on classified documents — correct.
- `skipDuplicates: true` with `externalRef + documentVersionId` as the dedup key prevents duplicate rows on retry.
- Dust rfp-extractor-agent with a regex fallback provides graceful degradation.

**Gaps:**

_Table structure is lost._ `pdf-parse` operates on the text layer only; `mammoth.extractRawText()` strips table markup. RFPs from procurement bodies (government, large enterprise) routinely encode mandatory requirements in formatted tables — compliance matrices, evaluation scoring grids, technical specification sheets. Text-layer extraction converts these to undifferentiated prose. The regex fallback (`shall|must|should`) cannot recover structure that was never extracted.

_No chunking._ The orchestrator enqueues a single job with `chunkIndex: 0, totalChunks: 1`. A 200-page government RFP exceeds any single-call context window. Long documents are silently truncated or cause Dust errors that fall through to the 50-requirement regex fallback.

_No minimum confidence filter._ All extracted requirements are persisted and fanned out for embedding regardless of confidence. A Dust parse that returns `confidenceBps: 1000` on an ambiguous sentence generates the same downstream work as a `confidenceBps: 9500` clean requirement. Bid managers reviewing the matrix will encounter noise rows that undermine trust in the list.

_Content-based deduplication absent._ The same requirement stated in two sections of an RFP (e.g., section 3.1 and appendix A) gets two separate rows with different `externalRef` values. The bid manager sees duplicates in the matrix.

_Priority assignment is fixed._ The fallback assigns `priority: 'medium'` to every requirement. Dust extraction fills `priority` from AI inference, but there is no mechanism to map the client's stated mandatory/desirable/optional language to the `Requirement.mandatory` flag in a consistent way. When the Requirement model has `mandatory Boolean @default(false)`, requirements extracted without an explicit mandatory field default to non-mandatory.

---

### 2.2 Story Matching — GAP (contains a CRITICAL scoring bug)

**What works:**

- pgvector HNSW cosine similarity search is architecturally sound.
- MMR diversity pruning prevents the top-5 from being semantic clones of the same story.
- Hybrid scoring formula design (cosine 55%, keyword 20%, tag 15%, recency 10%) is sensible in principle.
- Exponential recency decay with a 365-day half-life correctly de-weights stale references.

**Critical bug — keyword and tag dimensions are dead weight:**

The pgvector query in `rfp-story-match.ts` returns:

```sql
NULL::text AS title,
ARRAY[]::text[] AS tags,
NULL::timestamptz AS closed_at
```

There is no JOIN to the `references` table. The `keywordOverlapBps()` function computes Jaccard similarity between the requirement text and `refTitle` — which is always `NULL` — and always returns 0. `tagOverlapBps()` computes against `refTags` — always `[]` — and always returns 0. `recencyBps()` returns the neutral score (5000) when `closedAt` is null — and the `Reference` Prisma model has no `closedAt` field, so this is always null.

Effective weight in practice:

- Cosine: ~90% (intended 55%)
- Keyword: 0% (intended 20%)
- Tag: 0% (intended 15%)
- Recency: always neutral (intended 10% dynamic)

A story written ten years ago with no relevant tags but high semantic similarity to the requirement embedding will outscore a recent, correctly tagged story from the same industry. Bid managers will discover the mismatch within hours of use.

**Additional gaps:**

The `Reference` model stores `title`, `description`, `industry`, `valueMicros`, `tags[]`. It lacks: `sector`, `geography`, `teamSize`, `technology`, `closedAt`. Enterprise bid managers qualify stories against geography (a Middle East public sector story is not valid evidence for a German financial services RFP), contract value tier, and delivery team size. None of these are matchable.

The `StoryCard` UI displays hybrid score as a percentage and shows matched requirement count, but does not surface whether the match was driven by cosine alone or by validated keyword/tag/industry overlap. A score derived entirely from embedding similarity is epistemically weaker than one confirmed by all four signals. Presenting both as equivalent percentages is misleading.

The `topK = 5, candidateLimit = 10` defaults mean MMR is pruning from only 10 candidates. For a commodity requirement type (e.g., "must provide 24/7 support"), 10 candidates may all be semantically similar without being the strongest commercial evidence. A candidateLimit of 30–50 would produce meaningfully better diversity.

---

### 2.3 Compliance Matrix Approach — GAP

**What works:**

- YES/NO/PARTIAL/NOT_APPLICABLE response vocabulary matches standard bid compliance matrices.
- Per-row confidence score (0–10000 basis points) is appropriate for transparency.
- Row-level `approvedAt`/`approverUserId` fields exist in the schema, enabling granular sign-off.
- EU AI Act Art. 50 disclosure badge (`AiDisclosureBadge`) is present and non-toggleable when `autoFilled=true` — correct.
- Fallback to PARTIAL with 0 confidence and a manual completion note is safe.

**Gaps:**

_Mandatory flag ignored in AI assessment._ `rfp-compliance-fill.ts` does not read `Requirement.mandatory`. Every matrix row is assessed identically regardless of whether the client marked it as mandatory for award. In enterprise bid management, mandatory requirements drive go/no-go decisions; a PARTIAL on a mandatory item is a bid-stopper while a PARTIAL on a desirable item is acceptable. The current system produces the same output for both, and the matrix UI does not display mandatory/optional status.

_No N/A toggle in the UI._ The backend stores `NOT_APPLICABLE` but `ComplianceRow.tsx` has no N/A control. The edit mode opens a free-text textarea with no status selector. A bid manager cannot mark a row N/A without going outside the tool.

_The edit control has no save path._ `ComplianceRow.tsx` renders a textarea when `isEditing=true`, but the component contains no `onSave` prop and no save/submit button. The only interaction is the toggle between edit and done mode. The parent must wire a save handler — if it does not, edits are silently discarded. This is a UX contract that is not enforced by TypeScript: the `ComplianceRowProps` interface has no `onSave`.

_No duplicate-requirement deduplication in the matrix._ When the same requirement appears twice (two RFP sections), the matrix shows two rows. The bid manager assesses both. If the answers diverge, the proposal is internally contradictory.

_No evaluation criterion weighting._ Enterprise RFPs assign percentage weights to evaluation criteria (e.g., technical approach 40%, price 30%, experience 30%). The compliance fill prompt receives no weighting context, so the AI cannot signal which gaps are fatal to the bid score.

---

### 2.4 Section Drafting Realism — GAP

**What works:**

- Per-section AI drafting with Dust, fallback disabled (section drafting fails loudly rather than silently producing empty content).
- Story context injected into the prompt, including matched requirement count.
- MemOS policy and world-model context in `proposalRoutes` (`POST /proposals/:id/draft`).
- Tiptap rich text editor with `humanReviewed` status tracking.

**Gaps:**

_Story context is UUID-based._ `formatStoryContext()` in `rfp-section-draft.ts` formats references as `[Ref {UUID}]`. UUIDs are not human-readable. The AI cannot produce a citation like "similar work for Deutsche Telekom (2023)" — it can only produce `[Ref 3f8a...]`. A bid manager reviewing the AI draft has no way to verify which story was cited without cross-referencing IDs manually.

_4000-character story context ceiling is too low._ Enterprise section drafts for a technical approach section regularly run 2,000–5,000 words. The total story context feeding the AI is capped at 4,000 characters (~600 words) across all matched stories. The output will be generic because the model cannot see enough differentiated evidence.

_No structural guidance in the prompt._ The section draft prompt passes `sectionKey`, `sectionTitle`, `customer`, `opportunityContext`, and the story context blob, but no word count target, no page-count range, no evaluation criterion weighting, and no section-specific outline. An executive summary and a technical approach section are drafted with the same prompt template, differing only in `sectionTitle`. Enterprise proposals treat these as fundamentally different documents with distinct audience, tone, depth, and evidence requirements.

_No win-theme integration._ Enterprise bid management centres on 3–5 win themes that are threaded through every section. There is no win-theme data model, no win-theme prompt injection, and no mechanism for the bid manager to set themes that the AI reinforces across sections.

_`humanReviewed` is silently dropped._ `SectionEditor.tsx` calls `saveSection.mutate({ sectionId, payload: { content, humanReviewed: true } })`. The `ProposalSectionPatch` schema in `packages/shared/src/schemas/proposal.ts` is `z.object({ title: optional, content: optional })` — no `humanReviewed` field. The `ProposalSection` Prisma model has no `humanReviewed` column. The frontend sends a field the server silently strips. The bid manager believes they have marked a section as reviewed; the system has no record of it.

---

### 2.5 Human Approval Workflow — GAP

**What works:**

- Approval gate blocks autofill until `orchestration.state === 'approved'`.
- Single `approvedByUserId` + `approvedAt` recorded on the Proposal.
- Sequential 5-step checklist (executiveSummary → requirementsMapping → complianceMatrix → draftSections → legalClearance) enforces a logical review sequence.
- EU AI Act audit log fired on approval.

**Gaps:**

_Checklist state is in-memory only._ `ApprovalGate.tsx` holds checklist state in React `useState`. Refreshing the page resets all checkboxes. A multi-session review — the normal case for an enterprise bid (reviewed across days by multiple people) — cannot be persisted. A bid manager who completed 4 of 5 checkboxes and closed the browser starts from zero.

_Single approver._ The schema has one `approvedByUserId` on Proposal and no multi-approver join table. Enterprise bid governance typically requires: bid manager sign-off, practice lead sign-off, and legal/compliance sign-off. These are distinct roles with distinct accountability. A single approver model collapses that governance into an undifferentiated click.

_No minimum review period._ Nothing prevents an admin from uploading an RFP and approving the AI output 30 seconds later without reading anything. For regulatory environments (public procurement, defence) a minimum dwell time or mandatory comment on each checklist step is expected.

_No rejection workflow._ `RfpOrchestration.state` includes `rejected`, but there is no UI path for a reviewer to reject the pipeline output with a reason and route it back to the relevant stage. The only terminal states visible in the UI are approved and failed.

_No submission-ready export._ After approval there is no endpoint to export the assembled proposal as a PDF or DOCX file. The bid manager must manually reconstruct the document from the UI sections. For RFP portals that require a structured document upload, this gap makes the tool stop before the last metre.

---

### 2.6 Missing Capabilities — MISSING

These process steps have no presence in Wave 9:

**Bid / no-bid qualification (step 1).** No scoring model for bid attractiveness, win probability, strategic fit, or resource availability. Without this, every uploaded document proceeds to full pipeline regardless of fit.

**Red-flag / risk detection (step 5).** No mechanism to identify penalty clauses, indemnity obligations, IP assignment terms, exclusivity requirements, or performance bond demands. These are the clauses that cause bids to be rejected by legal before submission.

**Solution strategy (step 6).** No data model for the proposed solution, the delivery model, subcontractors, or the value proposition differentiation from competitors.

**Pricing and commercials (step 7).** No integration with rate cards, resource estimation, margin floor controls, or FX exposure on multi-currency RFPs.

**Legal and security review (steps 8–9).** Partial coverage through the legalClearance checklist step, but it is a binary checkbox with no connection to contract redlining tools, data residency validation, or security questionnaire automation.

**Submission readiness checklist (step 12).** No page count validation, no mandatory section completeness check, no portal format compliance (some portals require specific section numbering or file naming conventions).

**Post-submission tracking (step 13).** No clarification question management, no Q&A log, no outcome recording for model feedback (win/loss data feeds future story scoring).

---

## 3. Top 5 Wave 10 Enhancements (Priority Order)

### W10-1 — Fix the story-match scoring bug

**Impact: immediate trust loss if not fixed before any real bid.**

Restore the JOIN to the `references` table in the pgvector query so that `title`, `tags`, and `closedAt` are real values. Add `closedAt` to the `Reference` Prisma model. Until this is fixed, the hybrid scoring formula is a cosmetic wrapper around pure cosine similarity. Bid managers will ask "why is a 2015 story scoring higher than our 2024 win?" and there will be no credible answer.

### W10-2 — Persist checklist state and add multi-approver workflow

**Impact: the approval gate is not usable for real bids at current architecture.**

Store checklist step completion in the database (a `ProposalApprovalStep` join table with `userId`, `stepKey`, `completedAt`, `comment`). Add a multi-approver requirement to `Proposal` (e.g., `requiredApprovers: String[]`, `approvals: ProposalApproval[]`). The gate should remain locked until all required roles have approved. This aligns with RACI governance in enterprise bid management.

### W10-3 — Add mandatory/optional display and N/A control to the compliance matrix

**Impact: without this, bid managers cannot triage the matrix by risk.**

Surface `Requirement.mandatory` as a visual indicator (e.g., "M" badge or red asterisk) on every matrix row. Add a status selector to `ComplianceRow` with options: compliant / partial / non-compliant / N/A. Pass `mandatory` to the Dust compliance-fill prompt so the AI can calibrate justification length to risk. A PARTIAL on a mandatory requirement should trigger an automatic flag visible at the matrix summary level.

### W10-4 — Replace UUID citations with human-readable reference names and expand story context

**Impact: AI drafts are not auditable in their current form.**

Resolve reference UUIDs to `Reference.title + Reference.industry + year(closedAt)` in `formatStoryContext()`. Raise `MAX_STORY_CONTEXT_CHARS` to at least 8,000 characters (roughly 1,200 words — sufficient for 3 substantive stories). Add win-theme fields to `Proposal` (up to 5 themes) and inject them into every section draft prompt. Add section-specific word count targets and outline templates to the prompt.

### W10-5 — Implement document chunking and table-aware extraction

**Impact: large government RFPs (~200 pages) and table-structured compliance matrices are not handled.**

Partition `extractedText` into overlapping chunks (e.g., 8,000 tokens with 800-token overlap) and enqueue one `rfp.requirement-extract` job per chunk with correct `chunkIndex`/`totalChunks`. For table-structured PDFs, integrate a table-aware extractor (Camelot for native PDF, Tesseract table mode for scanned). Structure-aware extraction turns compliance matrix tables into pre-populated matrix rows rather than undifferentiated text blobs.

---

## 4. Risks That Could Cause Bid Managers to Distrust or Bypass the AI Drafts

### R1 — The story match score is not what it claims to be

The hybrid score displayed as a percentage in `StoryCard` is presented as the output of a four-factor model. In practice it is pure cosine similarity. A bid manager who spots a low-quality story ranked above an obvious winner will investigate. When they discover that keyword, tag, and recency signals are all zero, they will lose confidence in the entire scoring mechanism and default to manual story selection — exactly the behaviour the tool was designed to replace.

### R2 — Mandatory requirements look identical to optional ones

The matrix UI has no mandatory/optional indicator. A bid manager reviewing 80 matrix rows cannot tell at a glance which PARTIAL responses are bid-stoppers and which are inconsequential. The instinct is to read every row carefully — which takes as long as manual drafting. The tool has added work rather than removing it.

### R3 — AI-reviewed status is not tracked

When a bid manager saves a section, `humanReviewed: true` is silently dropped. The next session shows the section as unreviewed. The bid manager does not know whether a colleague has reviewed it. In a shared document environment (which enterprise bids always are), the absence of provenance tracking causes reviewers to re-review everything — again, adding work rather than removing it.

### R4 — Checklist progress is lost on browser refresh

A bid manager who spends 45 minutes working through the five-step approval checklist and accidentally closes the tab starts over. This will happen once per bid manager and the tool will be abandoned for that workflow. The approval gate will become a rubber-stamp click rather than a genuine review barrier.

### R5 — No export means the tool does not reach the submission portal

The value proposition of RFP automation is a finished, submittable document. If the bid manager must manually reconstruct the proposal from individual UI sections into a Word document before uploading to the procurement portal, the tool is perceived as a drafting aid rather than a full workflow — with all the adoption friction that entails. For clients with portal-mandated templates, the tool stops before the deliverable.

### R6 — UUID citations prevent independent verification

When a bid manager reads an AI-drafted section with `[Ref 3f8a-...]` and wants to confirm that the cited story actually supports the claim, they must leave the draft, navigate to the references database, look up the UUID, and cross-check. The friction is high enough that most will not bother — and the ones who do find the reference will be reviewing the reference rather than the draft quality. Citations that read "2024 implementation for a European public sector agency" are verifiable at a glance.

---

## 5. Summary Table

| Area                                       | Rating             | Highest risk                                                       |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------ |
| Document ingestion & extraction            | GAP                | Tables and long documents silently degrade                         |
| Requirement extraction                     | GAP                | No confidence threshold; content dedup absent                      |
| Story matching                             | GAP (CRITICAL bug) | Keyword/tag scoring dead; recency always neutral                   |
| Compliance matrix                          | GAP                | Mandatory flag ignored; N/A not in UI; edit has no save path       |
| Section drafting                           | GAP                | humanReviewed silently dropped; UUID citations; 4K context ceiling |
| Human approval workflow                    | GAP                | Checklist in-memory; single approver; no export                    |
| Bid qualification / risk / pricing / legal | MISSING            | Eight of thirteen operating model steps absent                     |

**Overall readiness for enterprise bid use:** the pipeline is a technically sound scaffold with a critical scoring defect and several UX gaps that will cause immediate trust loss in production. The extraction and drafting corridors are usable for low-stakes internal bids after the scoring bug is fixed. High-stakes government or regulated-sector bids require Wave 10 work before adoption.
