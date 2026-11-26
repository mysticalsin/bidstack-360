// An edit may say "Report not found" or "It may have been deleted." only
// after the read settles as a miss. A pause has isLoading false and no
// payload. That read is still unread. A failure is not a deleted report.

export type ReportEditPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface ReportEditSnapshot {
  data?: unknown;
  error?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = (error as { status: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function reportEditPhase(snapshot: ReportEditSnapshot): ReportEditPhase {
  const failed = snapshot.isError === true || snapshot.status === 'error';
  if (failed && httpStatus(snapshot.error) === 404) return 'missing';
  if (failed) return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
