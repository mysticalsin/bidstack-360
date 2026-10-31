import type { RawWatchEvent } from './edgar.js';

/** Minimal persistence port so the detector is testable without a database. */
export interface WatchdogStore {
  insertEvents(rows: Array<RawWatchEvent & { orgId: string; companyId: string }>): Promise<number>;
  notify(input: { orgId: string; userIds: string[]; companyId: string; title: string; body: string; url: string }): Promise<void>;
  markChecked(subjectId: string, at: Date, error: string | null): Promise<void>;
}

export interface WatchSubject {
  id: string;
  orgId: string;
  companyId: string;
  lastCheckedAt: Date | null;
  alertUserIds: string[];
}

export interface DetectResult {
  fetched: number;
  inserted: number;
  alerted: number;
  error: string | null;
}

/**
 * One scan for one account: pull from every adapter, persist idempotently
 * (store dedupes on orgId+source+externalId), alert on severity ≥ threshold.
 * A failing adapter records lastError; it never reports the watch as healthy.
 */
export async function detectAccountEvents(
  subject: WatchSubject,
  adapters: Array<(since: Date | undefined) => Promise<RawWatchEvent[]>>,
  store: WatchdogStore,
  opts: { now?: Date; minAlertSeverity?: number } = {},
): Promise<DetectResult> {
  const now = opts.now ?? new Date();
  const min = opts.minAlertSeverity ?? 3;
  const events: RawWatchEvent[] = [];
  const errors: string[] = [];
  for (const adapter of adapters) {
    try {
      events.push(...(await adapter(subject.lastCheckedAt ?? undefined)));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const inserted = events.length
    ? await store.insertEvents(events.map((e) => ({ ...e, orgId: subject.orgId, companyId: subject.companyId })))
    : 0;
  let alerted = 0;
  if (inserted > 0 && subject.alertUserIds.length > 0) {
    for (const e of events.filter((x) => x.severity >= min)) {
      await store.notify({
        orgId: subject.orgId,
        userIds: subject.alertUserIds,
        companyId: subject.companyId,
        title: `${e.implication === 'RISK' ? 'Risk' : e.implication === 'OPPORTUNITY' ? 'Opportunity' : 'Update'}: ${e.title}`,
        body: e.summary,
        url: e.sourceUrl,
      });
      alerted++;
    }
  }
  const error = errors.length ? errors.join('; ') : null;
  await store.markChecked(subject.id, now, error);
  return { fetched: events.length, inserted, alerted, error };
}
