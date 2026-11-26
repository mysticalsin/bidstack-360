// A collaborative note that has not synced is not an empty note.
// The pad stays on "checking" until the server init reply, or on "failed"
// when the server rejects the read. Local text that is already on the
// document stays visible either way.

export type CollabConnection = 'connecting' | 'connected' | 'disconnected' | 'error' | 'absent';

export type CollabNotesPhase = 'checking' | 'failed' | 'ready';

export function collabNotesRead(input: {
  connection: CollabConnection;
  textLength: number;
}): CollabNotesPhase {
  if (input.textLength > 0) return 'ready';
  if (input.connection === 'connected') return 'ready';
  if (input.connection === 'error') return 'failed';
  return 'checking';
}

/** A server `error` envelope is a failed read, not an empty document. */
export function collabServerMessageFailed(type: unknown): boolean {
  return type === 'error';
}

/**
 * After the socket closes: a failed read stays failed and does not reconnect.
 * A drop that was not a server rejection reconnects.
 */
export function collabSocketClosed(failed: boolean): {
  connection: 'error' | 'disconnected';
  reconnect: boolean;
} {
  if (failed) return { connection: 'error', reconnect: false };
  return { connection: 'disconnected', reconnect: true };
}

export function collabDocKey(entityType: string, entityId: string, fieldKey: string): string {
  return `${entityType}\n${entityId}\n${fieldKey}`;
}

export interface CollabDocSnap {
  connection: CollabConnection;
  textLength: number;
}

const ABSENT: CollabDocSnap = { connection: 'absent', textLength: 0 };

const snaps = new Map<string, CollabDocSnap>();
const listeners = new Map<string, Set<() => void>>();

export function publishCollabDoc(key: string, snap: CollabDocSnap): void {
  const prev = snaps.get(key);
  if (prev && prev.connection === snap.connection && prev.textLength === snap.textLength) return;
  snaps.set(key, snap);
  listeners.get(key)?.forEach((listener) => listener());
}

export function closeCollabDoc(key: string): void {
  if (!snaps.has(key)) return;
  snaps.delete(key);
  listeners.get(key)?.forEach((listener) => listener());
}

export function readCollabDoc(key: string): CollabDocSnap {
  if (!key) return ABSENT;
  return snaps.get(key) ?? ABSENT;
}

export function subscribeCollabDoc(key: string, listener: () => void): () => void {
  if (!key) return () => undefined;
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}
