// Demo-only read clock for the fixture deal intel payload.
// intelFor stores absolute stamps (refreshed 2026-05-10, triggers and news
// back to 2026-03-20). The deal page prints those days, so on a later clock
// the ribbon says the intel was refreshed in May and a NIS2 deadline is
// still "approaching" on 1 May. This slides a field that still holds its
// seeded instant so the refresh day is today. The gaps stay. The stored
// payload is not written. Real mode, and any mode other than exact `demo`,
// is unchanged. Hiring is left alone: the deal page does not print it.

/** Source literals in `intelFor`, not the `.000Z` form `toISOString` stores. */
export const FIXTURE_INTEL_STAMPS = {
  refreshed: '2026-05-10T08:00:00Z',
  observed: ['2026-04-15T00:00:00Z', '2026-03-20T00:00:00Z', '2026-05-01T00:00:00Z'],
  published: ['2026-04-22T00:00:00Z'],
} as const;

const TRIGGER_SUFFIX = ['-t1', '-t2', '-t3'] as const;

function instant(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sameInstant(value: string, stamp: string): boolean {
  const left = instant(value);
  const right = instant(stamp);
  return left != null && left === right;
}

/** Milliseconds to add so the seeded refresh day is today. Zero while that day is still today or later. */
export function fixtureIntelShiftMs(now: Date): number {
  const anchor = instant(FIXTURE_INTEL_STAMPS.refreshed);
  if (anchor == null || !Number.isFinite(now.getTime())) return 0;
  const anchorDate = new Date(anchor);
  const anchorDay = Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (anchorDay >= today) return 0;
  return today - anchorDay;
}

function slide(iso: string, shift: number): string {
  return new Date(Date.parse(iso) + shift).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * In demo, slide fixture refresh, trigger, and news stamps that still match
 * the seed. Anything else is the same value. The input is not changed.
 */
export function projectFixtureIntel<T>(intel: T, now: Date, mode: string | undefined): T {
  if (mode !== 'demo' || !isRecord(intel)) return intel;
  const shift = fixtureIntelShiftMs(now);
  if (shift === 0) return intel;

  let changed = false;
  let refreshedAt = intel.refreshedAt;
  if (typeof refreshedAt === 'string' && sameInstant(refreshedAt, FIXTURE_INTEL_STAMPS.refreshed)) {
    refreshedAt = slide(refreshedAt, shift);
    changed = true;
  }

  let triggers = intel.triggers;
  if (Array.isArray(triggers)) {
    let triggerChanged = false;
    const next = triggers.map((item) => {
      if (!isRecord(item)) return item;
      const id = item.id;
      const observedAt = item.observedAt;
      if (typeof id !== 'string' || typeof observedAt !== 'string') return item;
      const index = TRIGGER_SUFFIX.findIndex((suffix) => id.endsWith(suffix));
      const stamp = index >= 0 ? FIXTURE_INTEL_STAMPS.observed[index] : undefined;
      if (!stamp || !sameInstant(observedAt, stamp)) return item;
      triggerChanged = true;
      return { ...item, observedAt: slide(observedAt, shift) };
    });
    if (triggerChanged) {
      triggers = next;
      changed = true;
    }
  }

  let news = intel.news;
  if (Array.isArray(news)) {
    let newsChanged = false;
    const next = news.map((item) => {
      if (!isRecord(item)) return item;
      const id = item.id;
      const publishedAt = item.publishedAt;
      if (typeof id !== 'string' || typeof publishedAt !== 'string') return item;
      if (!id.endsWith('-n1') || !sameInstant(publishedAt, FIXTURE_INTEL_STAMPS.published[0])) return item;
      newsChanged = true;
      return { ...item, publishedAt: slide(publishedAt, shift) };
    });
    if (newsChanged) {
      news = next;
      changed = true;
    }
  }

  if (!changed) return intel;
  return { ...intel, refreshedAt, triggers, news } as T;
}
