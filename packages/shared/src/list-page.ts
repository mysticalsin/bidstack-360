/**
 * Shared list-page sizes and probe helpers.
 *
 * WHY: list captions must not call a truncated page the whole set. Each
 * query reads one row past the drawn page (`take()`), then `*Page()` drops
 * that extra row and sets `pageContinues`. API and web must agree on the
 * drawn size so a probe is never shown as a real row.
 */

function probePage<T>(
  rows: readonly T[],
  drawn: number,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/** Account files list. */
export const FILE_ATTACHMENTS_DRAWN = 100;

/** Query take: one past the files the list draws. */
export function fileAttachmentTake(limit = FILE_ATTACHMENTS_DRAWN): number {
  return limit + 1;
}

/** Drop the files probe row. `drawn` is the requested page, default 100. */
export function fileAttachmentPage<T>(
  rows: readonly T[],
  drawn = FILE_ATTACHMENTS_DRAWN,
): { items: T[]; pageContinues: boolean } {
  return probePage(rows, drawn);
}

/** Filed financial periods on an account card. */
export const FINANCIAL_PERIODS_DRAWN = 20;

/** Query take: one past the twenty filings the card draws. */
export function financialPeriodTake(): number {
  return FINANCIAL_PERIODS_DRAWN + 1;
}

/** Drop the filings probe row. */
export function filingPeriodPage<T>(
  rows: readonly T[],
): { periods: T[]; pageContinues: boolean } {
  const page = probePage(rows, FINANCIAL_PERIODS_DRAWN);
  return { periods: page.items, pageContinues: page.pageContinues };
}

/** People drawn on the account map. */
export const ACCOUNT_PEOPLE_DRAWN = 200;

/** Deal documents tab. */
export const OPPORTUNITY_DOCUMENTS_DRAWN = 50;

/** Query take: one past the files the deal documents tab draws. */
export function opportunityDocumentTake(): number {
  return OPPORTUNITY_DOCUMENTS_DRAWN + 1;
}

/** Drop the deal-documents probe row. */
export function opportunityDocumentPage<T>(
  rows: readonly T[],
): { items: T[]; pageContinues: boolean } {
  return probePage(rows, OPPORTUNITY_DOCUMENTS_DRAWN);
}

/** Linked contacts on a deal. */
export const OPPORTUNITY_CONTACTS_DRAWN = 500;

/** Query take: one past the contacts the deal list draws. */
export function opportunityContactTake(): number {
  return OPPORTUNITY_CONTACTS_DRAWN + 1;
}

/** Drop the linked-contact probe row. */
export function opportunityContactPage<T>(
  rows: readonly T[],
): { items: T[]; pageContinues: boolean } {
  return probePage(rows, OPPORTUNITY_CONTACTS_DRAWN);
}

/** Evidence items on an initiative card. */
export const INITIATIVE_EVIDENCE_DRAWN = 8;

/** Drop the initiative-evidence probe row. */
export function initiativeEvidencePage<T>(
  rows: readonly T[],
): { items: T[]; pageContinues: boolean } {
  return probePage(rows, INITIATIVE_EVIDENCE_DRAWN);
}

/** Company timeline events on the account page. */
export const TIMELINE_EVENTS_DRAWN = 300;

/** Query take: one past the events the timeline draws. */
export function timelineEventTake(): number {
  return TIMELINE_EVENTS_DRAWN + 1;
}

/** Drop the timeline probe row. */
export function timelineEventPage<T>(
  rows: readonly T[],
): { items: T[]; pageContinues: boolean } {
  return probePage(rows, TIMELINE_EVENTS_DRAWN);
}

/** Compliance matrix rows. */
export const COMPLIANCE_MATRIX_DRAWN = 500;

/** Query take: one past the rows the matrix draws. */
export function complianceMatrixTake(): number {
  return COMPLIANCE_MATRIX_DRAWN + 1;
}

/** Drop the compliance-matrix probe row. */
export function complianceMatrixPage<T>(
  rows: readonly T[],
): { items: T[]; pageContinues: boolean } {
  return probePage(rows, COMPLIANCE_MATRIX_DRAWN);
}

/** Extracted RFP requirements on the review list. */
export const EXTRACTED_REQUIREMENTS_DRAWN = 500;

/** Query take: one past the requirements the review list draws. */
export function extractedRequirementTake(): number {
  return EXTRACTED_REQUIREMENTS_DRAWN + 1;
}

/** Drop the extracted-requirement probe row. */
export function extractedRequirementPage<T>(
  rows: readonly T[],
): { items: T[]; pageContinues: boolean } {
  return probePage(rows, EXTRACTED_REQUIREMENTS_DRAWN);
}
