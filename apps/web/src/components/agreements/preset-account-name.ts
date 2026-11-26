// A child agreement already has an account id. The company list only supplies
// the name. A pause has no payload. That read is still unread. Error wins,
// then undefined data is unread, else the id is named or missing.

export type PresetAccountName =
  | { phase: 'unread' }
  | { phase: 'failed' }
  | { phase: 'missing' }
  | { phase: 'named'; name: string };

export interface PresetAccountSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

function nameFor(data: unknown, companyId: string): string | null {
  if (!data || typeof data !== 'object') return null;
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  for (const row of items) {
    if (!row || typeof row !== 'object') continue;
    if ((row as { id?: unknown }).id !== companyId) continue;
    const name = (row as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return null;
}

export function presetAccountName(snapshot: PresetAccountSnapshot, companyId: string): PresetAccountName {
  if (snapshot.isError === true || snapshot.status === 'error') return { phase: 'failed' };
  if (snapshot.data === undefined) return { phase: 'unread' };
  const name = nameFor(snapshot.data, companyId);
  if (name === null) return { phase: 'missing' };
  return { phase: 'named', name };
}
