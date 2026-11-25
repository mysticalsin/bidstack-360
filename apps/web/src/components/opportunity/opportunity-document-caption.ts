import { OPPORTUNITY_DOCUMENTS_DRAWN, opportunityDocumentPage } from '@bidstack/shared';

export { OPPORTUNITY_DOCUMENTS_DRAWN, opportunityDocumentPage };

/**
 * Files the documents tab draws. The API drops the probe and sets
 * `documentsContinue`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownOpportunityDocuments<T>(
  items: readonly T[],
  documentsContinue: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > OPPORTUNITY_DOCUMENTS_DRAWN) return opportunityDocumentPage(items);
  return { items: [...items], pageContinues: Boolean(documentsContinue) };
}

const DOCUMENT_KIND_LABEL: Record<string, string> = {
  rfp: 'RFP',
  sow: 'SoW',
  proposal: 'Proposal',
  qa: 'Q&A',
  reference: 'Reference',
};

/**
 * Stored document kind as a word. The demo file is `proposal`. An
 * unrecognized kind stays as stored. This does not invent a size.
 */
export function opportunityDocumentKindLabel(kind: string): string {
  return DOCUMENT_KIND_LABEL[kind] ?? kind;
}

/**
 * Deal files caption. A longer loaded list is the latest files, not every
 * file on the deal. One file is "1 file". A longer list that fits keeps
 * "N files". No file total is invented.
 */
export function opportunityDocumentCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every file`;
  }
  return count === 1 ? '1 file' : `${count} files`;
}
