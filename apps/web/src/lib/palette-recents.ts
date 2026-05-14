// Tracks the user's recent command-palette selections so the empty-state
// query can show "Continue where you left off." Persisted to localStorage
// with a version stamp — if we ever change the entry shape we bump the
// version and the old entries become invalid (best-effort, won't crash).

const STORAGE_KEY = 'bidstack.palette.recents.v1';
const MAX_RECENTS = 6;

export interface RecentEntry {
  id: string;
  group:
    | 'navigate'
    | 'opportunity'
    | 'account'
    | 'contact'
    | 'task'
    | 'company'
    | 'note'
    | 'sales_order'
    | 'invoice';
  label: string;
  hint?: string;
  route: string;
  visitedAt: string;
}

function read(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function isEntry(v: unknown): v is RecentEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.group === 'string' &&
    typeof o.label === 'string' &&
    typeof o.route === 'string'
  );
}

export function getRecents(): RecentEntry[] {
  return read();
}

export function pushRecent(entry: Omit<RecentEntry, 'visitedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const now = new Date().toISOString();
    const prev = read().filter((e) => e.id !== entry.id);
    const next = [{ ...entry, visitedAt: now }, ...prev].slice(0, MAX_RECENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or private-mode block — silent failure is fine,
    // recents are convenience, not correctness.
  }
}

export function clearRecents(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* silent */
  }
}
