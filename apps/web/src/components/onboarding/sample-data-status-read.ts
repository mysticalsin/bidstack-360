// The sample-data status may say it is off only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type SampleDataStatusPhase = 'unread' | 'failed' | 'ready';

export interface SampleDataStatusSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function sampleDataStatusPhase(
  snapshot: SampleDataStatusSnapshot,
): SampleDataStatusPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
