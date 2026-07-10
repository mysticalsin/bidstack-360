/**
 * paletteFrecency — frequency + recency ("frecency") memory for command-
 * palette selections, persisted to localStorage.
 *
 * WHY: lib/palette-recents.ts only surfaces the last 6 picks on an EMPTY
 * query. Once the user starts typing, a record they open every day should
 * outrank a rarely-used row with a marginally better text match — the
 * Raycast/Spotlight behavior. We store recent selection timestamps per row
 * id and convert them to a decayed score at palette-open time.
 *
 * Storage is best-effort: quota errors and private-mode blocks degrade to
 * "no boost", never to a crash.
 */

const STORAGE_KEY = 'bidstack.palette.frecency.v1';
// Caps keep the payload tiny (~2KB worst case) and naturally age out rows
// the user stopped selecting.
const MAX_IDS = 40;
const MAX_STAMPS_PER_ID = 8;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** id → ISO timestamps of recent selections, newest first. */
type FrecencyStore = Record<string, string[]>;

/** Recency decay buckets (Firefox-frecency style): a pick from this hour is
 *  worth 20× one from months ago. Bucketed rather than continuous so scores
 *  are stable within a session and trivially testable. */
export function recencyWeight(ageMs: number): number {
  if (ageMs < HOUR_MS) return 100;
  if (ageMs < DAY_MS) return 70;
  if (ageMs < 7 * DAY_MS) return 40;
  if (ageMs < 30 * DAY_MS) return 15;
  return 5;
}

export function frecencyScoreOf(stamps: readonly string[], now: number): number {
  let total = 0;
  for (const stamp of stamps.slice(0, MAX_STAMPS_PER_ID)) {
    const at = Date.parse(stamp);
    if (Number.isNaN(at)) continue;
    total += recencyWeight(Math.max(0, now - at));
  }
  return total;
}

/** Maps a raw frecency score onto rank points comparable with paletteFuzzy's
 *  bonuses: one recent pick (+4) can win a near-tie, a daily-driver row caps
 *  at +12 — enough to reorder peers, never enough to bury a much better
 *  text match. */
export function frecencyBoost(score: number): number {
  if (score <= 0) return 0;
  return Math.min(12, Math.round(score / 25));
}

function read(): FrecencyStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: FrecencyStore = {};
    for (const [id, stamps] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(stamps)) {
        store[id] = stamps
          .filter((s): s is string => typeof s === 'string')
          .slice(0, MAX_STAMPS_PER_ID);
      }
    }
    return store;
  } catch {
    // Corrupted JSON (or blocked storage) — treat as empty history.
    return {};
  }
}

/** Snapshot of decayed scores per canonical id. Taken once per palette open
 *  so rows don't reshuffle mid-session from the user's own selections. */
export function getFrecencyScores(now: number = Date.now()): Map<string, number> {
  const store = read();
  const scores = new Map<string, number>();
  for (const [id, stamps] of Object.entries(store)) {
    scores.set(id, frecencyScoreOf(stamps, now));
  }
  return scores;
}

export function recordPaletteSelection(id: string, now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    const store = read();
    store[id] = [new Date(now).toISOString(), ...(store[id] ?? [])].slice(0, MAX_STAMPS_PER_ID);
    const ids = Object.keys(store);
    if (ids.length > MAX_IDS) {
      // Evict the weakest ids so the payload stays bounded. The id just
      // selected always survives regardless of score ties.
      ids.sort(
        (a, b) => frecencyScoreOf(store[b] ?? [], now) - frecencyScoreOf(store[a] ?? [], now),
      );
      const keep = new Set<string>([id]);
      for (const candidate of ids) {
        if (keep.size >= MAX_IDS) break;
        keep.add(candidate);
      }
      for (const candidate of ids) {
        if (!keep.has(candidate)) delete store[candidate];
      }
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort persistence — see module doc.
  }
}

export function clearPaletteFrecency(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Different palette sources mint different ids for the SAME destination:
 * a fresh account row is `account:x`, its palette-recents echo is
 * `recent:account:x`, its cockpit-history echo is `recent-account:x`, and a
 * server search hit is `search:company:x`. Frecency must accrue to ONE
 * identity or repeat use would split across aliases and never build a
 * meaningful boost.
 */
export function canonicalPaletteId(id: string): string {
  if (id.startsWith('recent-account:')) return `account:${id.slice('recent-account:'.length)}`;
  if (id.startsWith('recent:')) return canonicalPaletteId(id.slice('recent:'.length));
  if (id.startsWith('search:')) {
    const rest = id.slice('search:'.length);
    if (rest.startsWith('opportunity:')) return `opp:${rest.slice('opportunity:'.length)}`;
    if (rest.startsWith('company:')) return `account:${rest.slice('company:'.length)}`;
    return rest;
  }
  return id;
}
