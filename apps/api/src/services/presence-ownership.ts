// The team list has one Redis row per person. A socket close may delete that
// row only when this close still owns it. A newer socket, or the team-list
// heartbeat (sessionId "http"), keeps the row. A blank session is not
// ownership: an empty heartbeat must not clear the team.

export function shouldRemovePresenceRow(raw: string | null, sessionId: string): boolean {
  if (sessionId.trim() === '') return false;
  if (raw === null) return false;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return false;
  }
  if (stored === null || typeof stored !== 'object') return false;

  const owned = (stored as { sessionId?: unknown }).sessionId;
  return typeof owned === 'string' && owned !== '' && owned === sessionId;
}
