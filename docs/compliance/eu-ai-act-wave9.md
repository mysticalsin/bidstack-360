# EU AI Act Art. 50 / GDPR Art. 5 Compliance Audit

## Wave 9 — RFP Automation Engine

**Audit date:** 2026-05-28
**Branch:** feat/wave9-rfp-engine
**Auditor:** QA-5 (EU AI Act Compliance Auditor)
**Commit:** d42cc08e (fixes applied in this audit session)

---

## Scope

| File                                                          | Purpose                                |
| ------------------------------------------------------------- | -------------------------------------- |
| `apps/api/src/routes/rfp-pipeline.ts`                         | POST /rfp-approve — human gate + audit |
| `apps/api/src/lib/ai-audit.ts`                                | AiInvocation audit log (API side)      |
| `apps/worker/src/lib/ai-audit-worker.ts`                      | AiInvocation audit log (worker side)   |
| `apps/web/src/components/rfp/shared/AiDisclosureBadge.tsx`    | Art. 50 disclosure component           |
| `apps/web/src/components/rfp/draft/DraftReviewPane.tsx`       | Draft section list                     |
| `apps/web/src/components/rfp/draft/SectionEditor.tsx`         | Section editor (via DraftReviewPane)   |
| `apps/web/src/components/rfp/compliance/ComplianceMatrix.tsx` | Compliance matrix container            |
| `apps/web/src/components/rfp/compliance/ComplianceRow.tsx`    | Individual compliance row              |
| `apps/worker/src/queues/rfp-embed-reference.ts`               | Reference embedding worker             |
| `apps/worker/src/queues/rfp-embed-requirement.ts`             | Requirement embedding worker           |

---

## EU AI Act Article 50 — Transparency (AI-generated content disclosure)

### Check 1 — AI Disclosure Badge rendered for AI-drafted sections

**Result: COMPLIANT**

`SectionEditor.tsx:40` renders `<AiDisclosureBadge />` when `section.aiGenerated === true`.
The `aiGenerated` field is provided by the `DraftSection` type in `useRfpDraft.ts:10`.
`DraftReviewPane.tsx` passes the section object through unchanged; the badge decision
is made at the editor level, correctly scoped to each section.

For compliance matrix rows: prior to this audit, `ComplianceRow.tsx` rendered only a
muted "AI X%" text span when `row.autoFilled === true`, which did not satisfy the
unambiguous-disclosure requirement of Art. 50. This was classified as HIGH non-compliance
and fixed (see Check 1a).

### Check 1a — ComplianceRow AI disclosure (FIXED in this session)

**Result before fix: NON-COMPLIANT (HIGH) — `ComplianceRow.tsx:66-73` (pre-fix)**
**Result after fix: COMPLIANT**

`row.autoFilled` triggered a `<span class="text-[10px] text-[var(--fg-tertiary)]">AI X%</span>`.
This fails Art. 50 because:

- The disclosure was a muted, fine-print confidence percentage — not an unambiguous label.
- The `AiDisclosureBadge` component existed but was not imported or rendered in this file.

Fix applied in commit d42cc08e:

- Added `import { AiDisclosureBadge }` to `ComplianceRow.tsx`.
- Wrapped the `autoFilled` block to render `<AiDisclosureBadge />` first, then the
  confidence percentage as supplementary information beneath it.

### Check 2 — Disclosure badge is non-dismissible / always visible

**Result: COMPLIANT**

`AiDisclosureBadge.tsx` is a plain `<span>` with no toggle, collapse, or dismiss mechanism.
In `SectionEditor.tsx`, it renders inline in the header row (`flex items-center justify-between`),
visible to the human reviewer before any editing begins.
In `ComplianceRow.tsx` (post-fix), it renders in the meta column with `flex flex-col items-end`.
Neither location places the badge behind an accordion, tab, or user preference gate.

### Check 3 — Approval audit trail (timestamp, approver, content)

**Result: COMPLIANT**

`rfp-pipeline.ts:529-543` — the `$transaction` block writes two records atomically:

1. `proposal.update` — sets `approvedAt`, `approvedByUserId`, `status='approved'`.
2. `auditLog.create` — records `action: 'proposal.rfp_approve'`, `targetId: proposalId`,
   `diff: { approvedAt, approvedByUserId, notes }`.

The audit record captures: timestamp (ISO-8601 `approvedAt`), approving user UUID, and
optional reviewer notes. The `targetId` links to the `Proposal` row, from which the
proposal name and AI-generated content can be retrieved.

One observation: the `diff` does not inline `proposalName` or a content fingerprint.
This is considered acceptable because the `targetId → Proposal` join provides full
content traceability. Logged as MINOR for future enhancement.

### Check 4 — Human approval gate is non-bypassable

**Result: COMPLIANT**

`rfp-pipeline.ts:507-514`:

- If `proposal.humanReviewRequired === false`, the endpoint returns HTTP 409 — it does not
  auto-approve. This means a misconfigured proposal cannot silently bypass review.
- If `proposal.approvedAt !== null` (already approved), returns HTTP 409.
- The database update (`approvedAt`, `approvedByUserId`) only occurs inside the `$transaction`
  after both guards pass.
- The autofill endpoint (`/rfp-autofill`) at line 441 separately guards on
  `orchestration.state !== 'approved'` — AI content cannot populate matrix rows unless
  the orchestration has been human-approved.

No auto-approve path was found.

---

## GDPR Article 5(1)(c) — Data Minimisation (AI audit logs)

### Check 5 — Prompt snippet truncated to ≤ 200 chars

**Result: COMPLIANT**

`ai-audit.ts:40-44` — `sanitizeSnippet()` calls `.slice(0, 200)` before any further
processing. This is applied at `ai-audit.ts:65` when writing `prompt_snippet`.
`ai-audit-worker.ts:43-47` is a functional mirror with identical implementation.

### Check 6 — Response snippet truncated to ≤ 200 chars

**Result: COMPLIANT**

`sanitizeSnippet()` is called for `response_snippet` at `ai-audit.ts:67` and
`ai-audit-worker.ts:66`. Same 200-char limit applies.

### Check 7 — No PII in audit log snippets

**Result: COMPLIANT (MEDIUM observation)**

`sanitizeSnippet()` masks:

- Email addresses via regex `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` → `[EMAIL]`
- Phone-like digit strings (7+ digits) via `\+?[0-9]{7,}` → `[PHONE]`

**MEDIUM observation:** Personal names (first name / surname) are not pattern-matched.
If a prompt includes "Reviewed by Jean Dupont" or a response references a named individual,
that name will appear in the 200-char snippet. The regex approach cannot reliably mask
free-text names without NLP. Recommended remediation: either accept this risk with a DPA
annotation, or strip text after a prompt/response structural boundary (e.g., store only
a task description, not the full user context).

This is not classified as a current violation because AI prompts in this pipeline are
template-driven (see `rfp-requirement-extract.ts` `buildAgentUserMessage()`) and do not
embed user names in the prompt by design. The risk is latent for future agent types.

### Check 8 — SHA-256 integrity hashes stored

**Result: COMPLIANT**

`ai-audit.ts:34-36` — `sha256()` hashes full prompt text. Applied at lines 64 and 66
for `prompt_hash` and `response_hash` respectively. The worker version is identical.
Hashes are stored alongside snippets in separate columns, enabling integrity verification
without storing full content.

### Check 9 — Retention policy / TTL mechanism

**Result: MINOR — referenced but not implemented**

`ai-audit.ts:6` and `ai-audit-worker.ts:9` both reference:

> "90-day retention enforced by scheduled cleanup job (rfp.audit-cleanup)"

No such queue, worker, or cron job exists anywhere in `apps/worker/src/`. The queue name
`rfp.audit-cleanup` is not registered in `packages/shared`. The comment describes an
intended control that has not been built.

**Risk:** `ai_invocations` rows accumulate indefinitely. If audit log volume is substantial
(e.g., 1 000+ AI calls/day), this creates both a storage cost and a GDPR storage-limitation
exposure (Art. 5(1)(e)). A 90-day TTL is reasonable for this data class.

**Remediation required:** Implement the `rfp.audit-cleanup` BullMQ worker or a Postgres
`pg_cron` job. Suggested: `DELETE FROM ai_invocations WHERE created_at < now() - INTERVAL '90 days'`
run daily. Register the queue name in `packages/shared` with `repeat: { cron: '0 3 * * *' }`.

---

## GDPR Article 5(1)(f) — Confidentiality / NDA Tier D Gate

### Check 10 — NDA Tier D gate in rfp-embed-reference.ts and rfp-embed-requirement.ts

**Result: rfp-embed-reference — NON-COMPLIANT (HIGH) before fix; COMPLIANT after fix**
**Result: rfp-embed-requirement — COMPLIANT (gate not required; see rationale)**
**Result: rfp-requirement-extract — COMPLIANT (gate present)**

**rfp-requirement-extract.ts:** NDA-D gate implemented at lines 126-156. Gate reads
`BidDocument.metadata.ndaTier` via a two-step join (DocumentVersion → BidDocument).
Returns false for Tier-D documents. Does not log `orchestrationId` or document identity.
Gate is called before any Dust AI invocation. Correct.

**rfp-embed-requirement.ts:** This worker receives job data enqueued by
`rfp-requirement-extract.ts` AFTER the NDA-D gate has already blocked Tier-D documents.
The requirement text in `contentText` was extracted from a document that already passed
the gate. A second gate at this level is not necessary because Tier-D documents never
reach the extract phase. Confirmed by examining the queue fan-out at
`rfp-requirement-extract.ts:288-298`.

**rfp-embed-reference.ts (pre-fix):** Reference documents are ingested independently
from the document extraction pipeline. The gate in rfp-requirement-extract does NOT cover
reference embeddings. The worker at line 96 had a TODO comment:

```
// TODO: add NDA tier check when SuccessStory model is added in Wave 10.
```

And fetched only `select: { id: true }` — metadata was not loaded, so ndaTier could not
be checked. A Tier-D reference document would have been sent to the Cohere embedding API.

Fix applied in commit d42cc08e:

- `select` extended to `{ id: true, metadata: true }`.
- NDA-D gate inserted at lines 110-124 of the updated file.
- On Tier-D match: sets `doNotRetry = true`, logs only `{ orgId }` (document ID omitted),
  returns gracefully without calling Cohere.
- Pattern is consistent with the existing gate in rfp-requirement-extract.ts.

---

## Summary Table

| #   | Check                                                 | Regulation   | Status            | Severity    | File:Line                        |
| --- | ----------------------------------------------------- | ------------ | ----------------- | ----------- | -------------------------------- |
| 1   | AI Disclosure Badge — DraftReviewPane / SectionEditor | Art. 50      | COMPLIANT         | —           | `SectionEditor.tsx:40`           |
| 1a  | AI Disclosure Badge — ComplianceRow (autoFilled)      | Art. 50      | COMPLIANT (fixed) | HIGH        | `ComplianceRow.tsx:67`           |
| 2   | Badge non-dismissible / always visible                | Art. 50      | COMPLIANT         | —           | `AiDisclosureBadge.tsx:6`        |
| 3   | Approval audit trail: timestamp + userId + content    | Art. 50      | COMPLIANT         | —           | `rfp-pipeline.ts:529`            |
| 4   | Human approval gate non-bypassable                    | Art. 50      | COMPLIANT         | —           | `rfp-pipeline.ts:507`            |
| 5   | Prompt snippet ≤ 200 chars                            | Art. 5(1)(c) | COMPLIANT         | —           | `ai-audit.ts:40`                 |
| 6   | Response snippet ≤ 200 chars                          | Art. 5(1)(c) | COMPLIANT         | —           | `ai-audit.ts:67`                 |
| 7   | No PII in audit snippets                              | Art. 5(1)(c) | COMPLIANT         | MEDIUM obs. | `ai-audit.ts:39-44`              |
| 8   | SHA-256 integrity hash                                | Art. 5(1)(c) | COMPLIANT         | —           | `ai-audit.ts:34`                 |
| 9   | Retention policy / TTL                                | Art. 5(1)(e) | MINOR gap         | MINOR       | comment-only                     |
| 10a | NDA Tier D gate — rfp-embed-reference                 | Art. 5(1)(f) | COMPLIANT (fixed) | HIGH        | `rfp-embed-reference.ts:110`     |
| 10b | NDA Tier D gate — rfp-embed-requirement               | Art. 5(1)(f) | COMPLIANT         | —           | gate upstream                    |
| 10c | NDA Tier D gate — rfp-requirement-extract             | Art. 5(1)(f) | COMPLIANT         | —           | `rfp-requirement-extract.ts:126` |

---

## Remediation Tracking

### Closed in this audit (commit d42cc08e)

- [x] **HIGH** ComplianceRow: AiDisclosureBadge missing for autoFilled compliance answers
- [x] **HIGH** rfp-embed-reference: no NDA Tier D gate before Cohere embedding call

### Open items

| Priority | Issue                                                                                                                                                                                     | Owner         | Due     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| MEDIUM   | `sanitizeSnippet()` does not mask personal names in prompt/response snippets. Accept risk with DPA annotation or add structural boundary stripping.                                       | Backend / DPO | Wave 10 |
| MINOR    | 90-day audit log retention job (`rfp.audit-cleanup`) referenced in comments but not implemented. Build the BullMQ cleanup job or pg_cron equivalent.                                      | Backend       | Wave 10 |
| MINOR    | `auditLog.diff` for `proposal.rfp_approve` does not inline proposal name or content fingerprint. Relies on `targetId` join for full traceability. Consider adding `proposalName` to diff. | Backend       | Wave 11 |

---

## Regulatory Citations

- **EU AI Act Art. 50(1):** Providers of AI systems shall ensure that AI-generated content
  is marked in a machine-readable format and detectable as artificially generated or
  manipulated. Deployers shall disclose to natural persons exposed to AI-generated content
  that the content has been artificially generated or manipulated.
- **GDPR Art. 5(1)(c):** Personal data shall be adequate, relevant and limited to what is
  necessary in relation to the purposes for which they are processed (data minimisation).
- **GDPR Art. 5(1)(e):** Personal data shall be kept in a form which permits identification
  of data subjects for no longer than is necessary for the purposes for which the personal
  data are processed (storage limitation).
- **GDPR Art. 5(1)(f):** Personal data shall be processed in a manner that ensures
  appropriate security of the personal data (integrity and confidentiality).
