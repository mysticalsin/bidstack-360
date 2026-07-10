// Read-path augmentation: merges live Sillage buying-intent signals into a
// persisted opportunity's `intel.triggers` on every detail-page read, so an
// operator who sets SILLAGE_* env sees fresh triggers without a backfill job,
// a worker, or a schema change. Config-gated no-op when Sillage isn't set up
// (see sillageIsConfigured). Fail-open everywhere — a Redis error, a slow
// Sillage, or a provider error must never make the opportunity page slower or
// less correct than before this file existed; the caller always gets back
// either the enriched intel or the original intel, never a rejection.
//
// Cache is intentionally NOT org-scoped: a Sillage lookup targets a public
// account (company name / domain), not org-owned data, so two orgs selling
// into the same account correctly share one cached lookup instead of each
// paying for a duplicate provider call.

import type { Logger as PinoLogger } from 'pino';

import type { Trigger } from '@bidstack/shared';

import { fetchSillageAccountSignals } from '../providers/sillage-signals.js';
import { cacheGet, cacheKey, cacheSet } from './redis-cache.js';

type AugmentLogger = Pick<PinoLogger, 'debug' | 'warn'>;

// Positive results are cheap to keep around; a GENUINE empty result is cached
// for a much shorter window so a newly-configured Sillage account (or a target
// that just started producing signals) isn't hammered on every read but also
// isn't stuck "empty" for an hour. A timeout or provider error is NOT cached —
// caching it would pin the Buying-triggers card empty for the negative TTL
// after one transient slow response, even though the direct route works.
const POSITIVE_CACHE_TTL_SECONDS = 3_600;
const NEGATIVE_CACHE_TTL_SECONDS = 300;
// Bounded wait so a slow Sillage response never stalls the opportunity page —
// on timeout we treat it exactly like "no signals yet" for this read.
const FETCH_TIMEOUT_MS = 1_500;
// In place of the (removed) negative cache for failures: after a timeout or
// error we skip Sillage for this target for a short window, so a down Sillage
// doesn't cost every read the full 1.5s race, yet recovers quickly.
const FAILURE_BACKOFF_MS = 30_000;
const failureBackoffUntil = new Map<string, number>();
// Keeps the Buying triggers card scannable regardless of how many signals a
// long-lived account has accumulated across both sources.
const MAX_TRIGGERS = 25;

export interface AugmentTriggersInput {
  companyName?: string;
  domain?: string;
  logger?: AugmentLogger;
}

/** True iff an operator has configured either Sillage credential. Everything
 * else in this module is a no-op when this is false. */
export function sillageIsConfigured(): boolean {
  return Boolean(process.env.SILLAGE_MCP_URL || process.env.SILLAGE_API_KEY);
}

/** Domain wins when both are present — it's the more precise account key. */
function normalizeTarget(companyName?: string, domain?: string): string | null {
  const site = domain?.trim().toLowerCase();
  if (site) return site;
  const name = companyName?.trim().toLowerCase();
  return name || null;
}

/**
 * Drop exact-id repeats and same (kind + label) near-duplicates. Existing
 * (already-persisted) triggers are listed first by the caller, so a
 * duplicate coming from Sillage loses to whatever we already had — we never
 * want a live fetch to silently replace curated/persisted trigger data.
 */
function dedupeTriggers(triggers: Trigger[]): Trigger[] {
  const seenIds = new Set<string>();
  const seenKindLabel = new Set<string>();
  const result: Trigger[] = [];
  for (const trigger of triggers) {
    const kindLabelKey = `${trigger.kind}::${trigger.label.trim().toLowerCase()}`;
    if (seenIds.has(trigger.id) || seenKindLabel.has(kindLabelKey)) continue;
    seenIds.add(trigger.id);
    seenKindLabel.add(kindLabelKey);
    result.push(trigger);
  }
  return result;
}

interface TimedFetchOutcome {
  signals: Trigger[];
  // True when the empty result is a timeout/rejection/provider error rather
  // than a genuine "no signals for this account" — failures must never be
  // cached as if the account were quiet.
  failed: boolean;
}

/**
 * Race the Sillage call against a timeout. The underlying provider call is
 * caught internally (never left to reject) so losing the race never produces
 * an unhandled rejection once the timeout has already resolved.
 */
async function fetchWithTimeout(
  input: { companyName?: string; domain?: string },
  logger: AugmentLogger | undefined,
): Promise<TimedFetchOutcome> {
  const safeFetch = fetchSillageAccountSignals(input).then(
    // The provider fails open: an internal failure resolves with `error` set,
    // which counts as failed here just like a rejection would.
    (result): TimedFetchOutcome => ({ signals: result.signals, failed: result.error !== undefined }),
    (err: unknown): TimedFetchOutcome => {
      logger?.warn({ err }, 'Sillage account-signals lookup threw; treating as no signals');
      return { signals: [], failed: true };
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimedFetchOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ signals: [], failed: true }), FETCH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([safeFetch, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Read-through cache: cache hit skips the provider entirely; a miss fetches,
 * then caches genuine results (including genuine empty) so repeat reads
 * within the TTL never re-hit Sillage. Timeouts/errors are never cached —
 * they only arm a short in-memory backoff for the target. */
async function getSillageTriggers(
  input: { companyName?: string; domain?: string },
  targetKey: string,
  logger: AugmentLogger | undefined,
): Promise<Trigger[]> {
  const key = cacheKey(['sillage', 'triggers', targetKey]);
  const { hit, data } = await cacheGet<Trigger[]>(key);
  if (hit && data) return data;

  const backoffUntil = failureBackoffUntil.get(targetKey);
  if (backoffUntil !== undefined) {
    if (Date.now() < backoffUntil) return [];
    failureBackoffUntil.delete(targetKey); // expired — keep the map bounded
  }

  const { signals, failed } = await fetchWithTimeout(input, logger);
  if (failed) {
    failureBackoffUntil.set(targetKey, Date.now() + FAILURE_BACKOFF_MS);
    return signals;
  }
  const ttl = signals.length > 0 ? POSITIVE_CACHE_TTL_SECONDS : NEGATIVE_CACHE_TTL_SECONDS;
  await cacheSet(key, signals, ttl);
  return signals;
}

/**
 * Merge live Sillage signals into a persisted `intel` payload's `triggers`.
 * Never mutates `intel`, never throws: any failure along the way (unconfigured,
 * no usable target, cache error, provider error/timeout, or an unexpected bug
 * in the merge itself) returns `intel` completely unchanged.
 */
export async function augmentTriggersWithSillage(
  intel: unknown,
  input: AugmentTriggersInput,
): Promise<unknown> {
  if (!sillageIsConfigured()) return intel;

  const targetKey = normalizeTarget(input.companyName, input.domain);
  if (!targetKey) return intel;

  try {
    const sillageTriggers = await getSillageTriggers(
      { companyName: input.companyName, domain: input.domain },
      targetKey,
      input.logger,
    );
    if (sillageTriggers.length === 0) return intel;

    const base = intel && typeof intel === 'object' ? (intel as Record<string, unknown>) : {};
    const existing = Array.isArray(base.triggers) ? (base.triggers as Trigger[]) : [];
    const merged = dedupeTriggers([...existing, ...sillageTriggers])
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_TRIGGERS);

    return { ...base, triggers: merged };
  } catch (err) {
    input.logger?.warn({ err }, 'Sillage triggers augmentation failed; returning intel unchanged');
    return intel;
  }
}
