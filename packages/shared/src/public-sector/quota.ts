import { PsSourceError } from './errors.js';
import { zonedDateKey, zonedParts, zonedTimeToUtc } from './time.js';
import type { PsQuotaReserver } from './types.js';

/** Chile's official zone; quota days and quiet hours follow it. */
export const CHILE_TIME_ZONE = 'America/Santiago';

/** Published Mercado Publico limit per ticket per day. Not negotiable. */
export const MERCADOPUBLICO_DAILY_LIMIT = 10_000;

/** Share of the daily limit Polo never uses (spec 3.3 sizes the limiter to 80%). */
export const DEFAULT_QUOTA_SAFETY_MARGIN = 0.2;

/** Recommended bulk window, local hours [start, end): 22:00 to 07:00. */
export const BULK_QUIET_HOURS = [22, 7] as const;

/** Shared counter. In the worker this is Redis `INCR` plus `EXPIRE`. */
export interface QuotaCounterStore {
  increment(key: string, ttlSeconds: number): Promise<number>;
}

/** Process-local store for tests and single-process tools. */
export class InMemoryQuotaStore implements QuotaCounterStore {
  private readonly counts = new Map<string, number>();

  /** Increment and return the new count. TTL is ignored in memory. */
  async increment(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  /** Keys seen so far (test helper). */
  keys(): string[] {
    return [...this.counts.keys()];
  }
}

/** Chile calendar day used to bucket the quota. */
export function quotaDayKey(now: Date, timeZone: string = CHILE_TIME_ZONE): string {
  return zonedDateKey(now, timeZone);
}

/** A quota guard bound to one credential. */
export interface QuotaGuard extends PsQuotaReserver {
  readonly ceiling: number;
}

/**
 * Daily quota guard for one ticket.
 *
 * Keyed by a credential id (for example the integration config row id), never
 * by the ticket value. The ceiling is the hard limit minus the safety margin;
 * the call that would cross it is refused with `doNotRetry`, so the source
 * pauses until the next Chile day.
 */
export function createQuotaGuard(opts: {
  store: QuotaCounterStore;
  credentialId: string;
  dailyLimit?: number;
  safetyMargin?: number;
  timeZone?: string;
  now?: () => Date;
}): QuotaGuard {
  const dailyLimit = opts.dailyLimit ?? MERCADOPUBLICO_DAILY_LIMIT;
  const margin = opts.safetyMargin ?? DEFAULT_QUOTA_SAFETY_MARGIN;
  if (!(margin >= 0 && margin < 1)) {
    throw new Error('Quota safety margin must be in [0, 1)');
  }
  if (!(dailyLimit > 0 && dailyLimit <= MERCADOPUBLICO_DAILY_LIMIT)) {
    throw new Error(`Daily limit must be between 1 and ${MERCADOPUBLICO_DAILY_LIMIT}`);
  }
  if (!/^[\w.-]{1,128}$/.test(opts.credentialId)) {
    throw new Error('Quota credential id must be a short identifier, not a credential value');
  }
  const ceiling = Math.floor(dailyLimit * (1 - margin));
  const timeZone = opts.timeZone ?? CHILE_TIME_ZONE;
  const now = opts.now ?? (() => new Date());

  return {
    ceiling,
    async reserve() {
      const key = `ps:quota:${opts.credentialId}:${quotaDayKey(now(), timeZone)}`;
      const used = await opts.store.increment(key, 2 * 24 * 60 * 60);
      if (used > ceiling) {
        throw new PsSourceError(
          'quota_exhausted',
          `Daily quota ceiling of ${ceiling} reached for this credential`,
          { doNotRetry: true },
        );
      }
      return { used, remaining: ceiling - used };
    },
  };
}

/** True when the local hour in `timeZone` is inside `[start, end)`, wrapping midnight. */
export function isWithinQuietHours(
  now: Date,
  window: readonly [number, number] = BULK_QUIET_HOURS,
  timeZone: string = CHILE_TIME_ZONE,
): boolean {
  const { hour } = zonedParts(now, timeZone);
  const [start, end] = window;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Next start of the quiet window, or `now` when already inside it. */
export function nextQuietWindowStart(
  now: Date,
  window: readonly [number, number] = BULK_QUIET_HOURS,
  timeZone: string = CHILE_TIME_ZONE,
): Date {
  if (isWithinQuietHours(now, window, timeZone)) return now;
  const p = zonedParts(now, timeZone);
  const today = zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: window[0] }, timeZone);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedTimeToUtc(
    {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour: window[0],
    },
    timeZone,
  );
}

/** Refuse bulk work outside the quiet window; the error says when to retry. */
export function assertBulkWindow(now: Date = new Date()): void {
  if (isWithinQuietHours(now)) return;
  const next = nextQuietWindowStart(now);
  throw new PsSourceError('outside_quiet_hours', 'Bulk imports run 22:00 to 07:00 America/Santiago', {
    retryAfterMs: next.getTime() - now.getTime(),
  });
}
