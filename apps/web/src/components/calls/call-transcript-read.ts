// A call transcript may say "Transcript not yet available." only after the
// call payload arrives without one. A pause has no transcript yet. That
// read is still unread. A failure is not an empty transcript.

export type CallTranscriptPhase = 'local' | 'unread' | 'failed' | 'ready';

export interface CallTranscriptSnapshot {
  callId?: string;
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function callTranscriptPhase(snapshot: CallTranscriptSnapshot): CallTranscriptPhase {
  if (!snapshot.callId) return 'local';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
