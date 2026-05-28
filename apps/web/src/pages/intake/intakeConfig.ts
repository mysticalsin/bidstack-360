/**
 * intakeConfig — shared constants and types for the Intake workflow.
 * No React/JSX — safe to import from tests or other non-JSX files.
 */

export const STEPS = [
  { id: 'receive', label: 'Receive' },
  { id: 'extract', label: 'Extract' },
  { id: 'review', label: 'Review' },
  { id: 'publish', label: 'Publish' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

/** A single extraction job item as returned by the account-intel endpoint. */
export interface ExtractionItem {
  documentId: string;
  status: string;
  error: string | null;
}

/** A solution or product extracted from a document. */
export interface ExtractedItem {
  id: string;
  name: string;
  description: string | null;
  confidenceBps: number;
}
