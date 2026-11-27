// The sector pipeline chart may say the book is empty only after the
// rows arrive. A pause has isLoading false and no rows. That read is
// still unread. A failure with no payload is not an empty chart.

export type SectorPipelinePhase = 'unread' | 'failed' | 'ready';

export interface SectorPipelineSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function sectorPipelinePhase(snapshot: SectorPipelineSnapshot): SectorPipelinePhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
