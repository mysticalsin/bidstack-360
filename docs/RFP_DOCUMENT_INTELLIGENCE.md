# BidStack 360 Document Intelligence

## Goal

BidStack needs a first-class document intelligence workspace for RFP, RFI, RFQ,
proposal, amendment, legal, pricing, and reference documents. The workflow must
support secure upload, open-source OCR, source-grounded extraction, configurable
review agents, human approvals, and auditable proposal automation.

See `docs/RFP_RESPONSE_OPERATING_MODEL.md` for the canonical phase-by-phase RFP
response process and configurable Claude/Dust agent model.

## OCR / Conversion Stack

Use a layered open-source pipeline:

1. Native parsers first: existing `pdf-parse`, `mammoth`, `word-extractor`,
   `node-pptx-parser`, and spreadsheet extraction for text-bearing files.
2. OCRmyPDF + Tesseract for scanned PDFs and image uploads. This keeps scanned
   PDFs searchable and preserves a PDF artifact with a text layer.
3. Docling worker service next for layout-aware extraction, tables, reading
   order, page/section structure, and richer Markdown/JSON conversion.
4. Optional Apache Tika sidecar later for long-tail file type detection and
   metadata extraction.

The current implementation adds optional OCR to the API extraction utility using:

- `BIDSTACK_OCR_ENABLED`
- `BIDSTACK_OCR_LANGUAGES`
- `BIDSTACK_OCR_TIMEOUT_MS`
- `BIDSTACK_OCRMYPDF_BIN`
- `BIDSTACK_TESSERACT_BIN`

Current implementation target: heavy conversion now belongs to the worker. API
routes stay limited to tenant validation, upload finalization, job creation, and
status reads.

## Core Entities

- `BidDocument`: uploaded RFP/RFI/RFQ/amendment/proposal/reference artifact.
- `DocumentVersion`: immutable file hash, extracted text, layout JSON, uploader,
  OCR engine version, and timestamp.
- `SourceChunk`: page/section/table/cell-level source span for citations.
- `Requirement`: atomic obligation extracted from solicitation text.
- `ComplianceMatrixRow`: requirement, owner, answer status, risk, evidence,
  source citation, due date, and approval state.
- `ResponseSection`: proposal section mapped to requirements and citations.
- `ReusableAnswer`: approved content library item with owner, expiry, tags, and
  evidence links.
- `ReviewIssue`: legal, security, delivery, commercial, or content finding.
- `BidRisk`: delivery, legal, finance, compliance, resource, or strategic risk.
- `ApprovalGate`: version-locked sign-off for bid/no-bid, legal, pricing,
  red-team, and final submission.
- `SubmissionPackage`: final proposal bundle, attachments, checklist, and receipt.

## Agent Model

Agents are configurable records, not hardcoded prompts. Required starter agents:

- Intake Agent: classifies docs, detects amendments, extracts deadlines.
- Compliance Agent: extracts and maintains requirement suggestions.
- Citation Agent: verifies every generated claim has source evidence.
- Answer Librarian: recommends approved reusable answers.
- Legal Agent: flags terms, deviations, privacy, IP, liability, and SLA risks.
- Sales Strategy Agent: win themes, competitor positioning, executive narrative.
- Risk / No-Bid Agent: fit, margin, timing, compliance, and capacity score.
- Chief of Staff Agent: owners, blockers, digest, escalation, readiness.
- Approval Agent: gate readiness and version lock enforcement.
- Submission QA Agent: final package preflight.

Agents may classify, summarize, draft, compare, and recommend. They must not
silently approve gates, mutate canonical CRM records, delete files, or mark
requirements complete without deterministic validation plus human action.

## Golden Workflow

1. Upload documents into a dedicated Document Intelligence workspace.
2. Validate file type, size, MIME, tenant scope, storage key, and virus scan.
3. Convert/OCR into text, layout JSON, source chunks, tables, and metadata.
4. Extract document map: deadline, buyer, portal/email, evaluation criteria,
   response format, mandatory attachments, page limits, amendments.
5. Extract atomic requirements with source citations and confidence.
6. Build compliance matrix with editable rows and bulk assignment.
7. Bind opportunity context: account, decision unit, competitors, timeline,
   tasks, notes, products, references, and prior similar bids.
8. Run configurable agents for legal, sales, risk/no-bid, CoS, and QA.
9. Draft cited response sections from accepted sources and reusable answers.
10. Route reviews and approvals with version locking.
11. Preflight final package and export.

## UX Requirements

- Dedicated nav section: `Documents` or `Bid Workspace`.
- Drag/drop upload with document type, version, OCR status, and confidence.
- Split document viewer: original page/table on one side, extracted obligations
  and matrix rows on the other.
- Compliance matrix with keyboard navigation, filters, owners, bulk actions,
  comments, history, and export.
- Requirement detail with source text, interpretation, draft answer, evidence,
  reusable answers, comments, and approvals.
- Agent panel with configurable role, system prompt, allowed tools, input scope,
  and last-run evidence.
- Readiness dashboard with deterministic scoring and visible blockers.
- Amendment diff view showing impacted requirements and answers.

## Security Requirements

- Every query and mutation must include `orgId`.
- Uploads must stay org-keyed in storage and DB.
- OCR jobs must be tenant-scoped by `orgId`, document id, and extraction id.
- Agent tool access must be permission-scoped and audited.
- Generated content must include citations before it can be marked trusted.
- Approval gates must lock to exact document versions.
- Final exports must be audited and filename-sanitized.
- Scanned/image OCR should run in a sandboxed worker container with CPU/time/file
  limits, not in the main API process for production.

## Implementation Slices

1. Immediate hardening: tenant-scoped extraction updates, route rate limits,
   agent mutation RBAC, optional OCR for scanned PDFs/images.
2. Worker conversion service: move extraction from API to worker, add OCR job
   states, store extracted text/layout metadata, and expose progress.
3. RFP domain model: BidDocument, DocumentVersion, SourceChunk, Requirement,
   ComplianceMatrixRow, ReviewIssue, ApprovalGate.
4. Bid Workspace UI: intake, document viewer, compliance matrix, agent panel.
5. Proposal automation: cited drafting, reusable answer matching, review gates,
   export.

## Open-Source References

- OCRmyPDF: https://ocrmypdf.readthedocs.io/
- Tesseract: https://tesseract-ocr.github.io/tessdoc/
- Docling: https://github.com/docling-project/docling
- Apache Tika: https://tika.apache.org/
