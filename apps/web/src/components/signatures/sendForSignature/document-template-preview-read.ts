// A document template preview may say there is nothing to preview only after
// the payload arrives. A pause has isLoading false and no body. That read is
// still unread. A failure with no payload is not an empty preview. A review
// that never asked for a template is absent, not unread.

export type DocumentTemplatePreviewPhase = 'absent' | 'unread' | 'failed' | 'ready';

export interface DocumentTemplatePreviewReadSnapshot {
  templateId: string;
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function documentTemplatePreviewPhase(
  snapshot: DocumentTemplatePreviewReadSnapshot,
): DocumentTemplatePreviewPhase {
  if (!snapshot.templateId) return 'absent';
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
