// The deal documents tab may say "No documents attached" only after the
// file list arrives. A missing list is still unread. A failed read is not
// an empty bid, even when the caller also hands over an empty array.

export type DealDocumentPhase = 'unread' | 'failed' | 'ready';

export interface DealDocumentSnapshot {
  documents?: unknown;
  documentsFailed?: boolean;
}

export function dealDocumentPhase(snapshot: DealDocumentSnapshot): DealDocumentPhase {
  if (snapshot.documentsFailed === true) return 'failed';
  if (snapshot.documents === undefined) return 'unread';
  return 'ready';
}
