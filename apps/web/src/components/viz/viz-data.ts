// Pure derivations behind the dashboard + account visuals. Everything here is
// computed from API rows; nothing is invented. Kept pure so it is unit-tested.
import { microsToUnits } from '@bidstack/shared';

import {
  headlineMicrosLabel,
  recordedMicros,
  recordedPipelineCompact,
} from '@/components/dashboard/unspecified-currency';
import { closedOutcome, LEGACY_PIPELINE_STAGES } from '@/lib/pipeline-stages';

export const OPEN_STAGES = ['s1_lead', 's1_ongoing', 's2_sent', 's3_technical_iteration', 's4_negotiation'] as const;

const NAME_TO_ID = new Map(LEGACY_PIPELINE_STAGES.map((s) => [s.name.toLowerCase(), s.id]));
const ID_TO_NAME = new Map(LEGACY_PIPELINE_STAGES.map((s) => [s.id, s.name]));

/** Normalise "S1 Lead" / "s1_lead" to the legacy stage id. */
export function stageKey(stage: string | null | undefined): string {
  if (!stage) return 'unknown';
  if (ID_TO_NAME.has(stage)) return stage;
  return NAME_TO_ID.get(stage.toLowerCase()) ?? stage;
}

/** Sentence-case label: "S3 Technical Iteration" -> "S3 technical iteration". */
export function stageText(stage: string): string {
  const name = ID_TO_NAME.get(stageKey(stage)) ?? stage.replace(/_/g, ' ');
  return name.charAt(0) + name.slice(1).toLowerCase();
}

export interface OppRow {
  id: string;
  stage: string | null;
  value: number | null;
  probability?: number | null;
  dueDate: string | null;
  customer: string | null;
  closedAt?: string | null;
  /** Present on API rows; used by drill-down tables. */
  name?: string | null;
  code?: string | null;
  owner?: string | null;
  /** Live stage flags. A deleted stage row is not a close. */
  pipelineStage?: { isWon?: boolean; isLost?: boolean; deletedAt?: string | Date | null } | null;
  /** Integer micros. The unit number cannot keep a cent past a safe integer. */
  valueMicros?: string | null;
}

const isWon = (o: OppRow) => closedOutcome(o) === 'won';
const isLost = (o: OppRow) => closedOutcome(o) === 'lost';
const isClosed = (o: OppRow) => isWon(o) || isLost(o);
/** When a closed bid closed: closedAt when recorded, else its due date. */
export const closeDate = (o: OppRow): string | null => o.closedAt ?? o.dueDate;

/** Dates are calendar days: bucket on the UTC date so "2026-10-01" stays in Q4. */
export function quarterOf(iso: string): string {
  const d = new Date(iso);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

export interface StageBucket {
  id: string;
  label: string;
  value: number;
  /** Exact total, compact only when that label is the same cent. */
  amount: string;
  /** Integer micros behind `amount`. Bar length still uses `value`. */
  micros: string;
  count: number;
}

const STAGE_RANK = new Map<string, number>([
  ...OPEN_STAGES.map((id, index) => [id, index] as const),
  ['closed_won', 200],
  ['closed_lost', 201],
]);

/** One bar per stage that actually has rows. Legacy open keys stay in pipeline order, a named stage follows, then won and lost. */
export function stageBuckets(rows: OppRow[]): StageBucket[] {
  const buckets = new Map<string, Omit<StageBucket, 'micros'> & { rank: number; micros: bigint }>();
  for (const row of rows) {
    const id = stageKey(row.stage);
    const current = buckets.get(id) ?? {
      id,
      label: stageText(id),
      value: 0,
      amount: '',
      count: 0,
      rank: STAGE_RANK.get(id) ?? 100,
      micros: 0n,
    };
    current.micros += recordedMicros(row.value ?? 0, row.valueMicros);
    current.count += 1;
    buckets.set(id, current);
  }
  return [...buckets.values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map(({ rank: _rank, micros, ...bucket }) => ({
      ...bucket,
      value: microsToUnits(micros),
      amount: headlineMicrosLabel(micros, 'en-GB'),
      micros: micros.toString(),
    }));
}

export function stageFunnel(rows: OppRow[]): StageBucket[] {
  return stageBuckets(rows.filter((row) => !isClosed(row)));
}

export function statusMix(rows: OppRow[]) {
  const open = rows.filter((o) => !isClosed(o)).length;
  return { open, won: rows.filter(isWon).length, lost: rows.filter(isLost).length };
}

/** Win rate per close quarter (count-based), oldest first. */
export function winRateByQuarter(rows: OppRow[]) {
  const by = new Map<string, { won: number; lost: number; t: number }>();
  for (const o of rows) {
    const at = isClosed(o) ? closeDate(o) : null;
    if (!at) continue;
    const q = quarterOf(at);
    const cur = by.get(q) ?? { won: 0, lost: 0, t: new Date(at).getTime() };
    if (isWon(o)) cur.won += 1; else cur.lost += 1;
    cur.t = Math.min(cur.t, new Date(at).getTime());
    by.set(q, cur);
  }
  return [...by.entries()]
    .sort((a, b) => a[1].t - b[1].t)
    .map(([x, v]) => {
      const t = new Date(v.t);
      const date = new Date(t.getUTCFullYear(), Math.floor(t.getUTCMonth() / 3) * 3, 1);
      return { x, date, won: v.won, lost: v.lost, rate: Math.round((v.won / (v.won + v.lost)) * 100) };
    });
}

/** Won value per close quarter (actuals), oldest first. */
export function wonByQuarter(rows: OppRow[]) {
  const by = new Map<string, { v: bigint; t: number }>();
  for (const o of rows.filter(isWon)) {
    const at = closeDate(o);
    if (!at) continue;
    const q = quarterOf(at);
    const cur = by.get(q) ?? { v: 0n, t: new Date(at).getTime() };
    cur.v += recordedMicros(o.value ?? 0, o.valueMicros);
    by.set(q, cur);
  }
  return [...by.entries()].sort((a, b) => a[1].t - b[1].t).map(([label, v]) => ({
    label,
    won: microsToUnits(v.v),
    wonMicros: v.v.toString(),
  }));
}

const monFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
/** Cumulative won value by close month for the year of the latest close. */
export function cumulativeWon(rows: OppRow[]) {
  const won = rows.filter(isWon).flatMap((o) => {
    const at = closeDate(o);
    return at ? [{ at, v: recordedMicros(o.value ?? 0, o.valueMicros) }] : [];
  });
  if (!won.length) return [];
  const year = Math.max(...won.map((r) => new Date(r.at).getUTCFullYear()));
  const lastMonth = Math.max(...won.filter((r) => new Date(r.at).getUTCFullYear() === year).map((r) => new Date(r.at).getUTCMonth()));
  let run = 0n;
  return Array.from({ length: lastMonth + 1 }, (_, m) => {
    for (const deal of won) {
      const d = new Date(deal.at);
      if (d.getUTCFullYear() === year && d.getUTCMonth() === m) run += deal.v;
    }
    const date = new Date(year, m, 1); // local midnight, for axis display only
    return { x: monFmt.format(date), date, y: microsToUnits(run), yMicros: run.toString() };
  });
}

/** Per-account open vs won value, top N by the micros total. Bar length stays a unit number. */
export function accountBars(rows: OppRow[], n = 6) {
  const by = new Map<string, { open: bigint; won: bigint }>();
  for (const o of rows) {
    if (!o.customer || isLost(o)) continue;
    const cur = by.get(o.customer) ?? { open: 0n, won: 0n };
    const micros = recordedMicros(o.value ?? 0, o.valueMicros);
    if (isWon(o)) cur.won += micros; else cur.open += micros;
    by.set(o.customer, cur);
  }
  return [...by.entries()]
    .map(([label, v]) => {
      const open = microsToUnits(v.open);
      const won = microsToUnits(v.won);
      const openMicros = v.open.toString();
      const wonMicros = v.won.toString();
      return {
        label,
        open,
        won,
        openMicros,
        wonMicros,
        openLabel: recordedPipelineCompact(openMicros, open),
        wonLabel: recordedPipelineCompact(wonMicros, won),
        totalLabel: recordedPipelineCompact((v.open + v.won).toString(), open + won),
      };
    })
    .sort((a, b) => {
      const aTotal = BigInt(a.openMicros) + BigInt(a.wonMicros);
      const bTotal = BigInt(b.openMicros) + BigInt(b.wonMicros);
      if (aTotal === bTotal) return a.label.localeCompare(b.label);
      return aTotal > bTotal ? -1 : 1;
    })
    .slice(0, n);
}

/** Open bids due before today UTC. A bid due today is still open, matching the overdue list. */
export function pastDueOpen(rows: OppRow[], now = Date.now()) {
  const at = new Date(now);
  const startOfTodayUTC = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return rows.filter((o) => {
    if (isClosed(o) || !o.dueDate) return false;
    const due = new Date(o.dueDate).getTime();
    return Number.isFinite(due) && due < startOfTodayUTC;
  });
}

/** Running win rate after each closed bid, in close order (sparkline). */
export function runningWinRate(rows: OppRow[]) {
  const closed = rows.filter((o) => isClosed(o) && closeDate(o)).sort((a, b) => new Date(closeDate(a)!).getTime() - new Date(closeDate(b)!).getTime());
  let won = 0;
  return closed.map((o, i) => { if (isWon(o)) won += 1; return Math.round((won / (i + 1)) * 100); });
}

/** Cumulative open value by due date (sparkline). */
export function cumulativeOpen(rows: OppRow[]) {
  const open = rows.filter((o) => !isClosed(o)).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  if (!open.length) return [];
  // Starts at 0 so a single open bid still draws a rising line.
  let run = 0n;
  return [0, ...open.map((o) => microsToUnits((run += recordedMicros(o.value ?? 0, o.valueMicros))))];
}

function forecastMicros(value: string | number | null | undefined): bigint | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export interface ForecastPoint {
  label: string;
  won: number;
  weighted: number;
  open: number;
  wonLabel: string;
  weightedLabel: string;
  openLabel: string;
}

/** Bar height from integer micros. A digit string that does not fit in a JavaScript number is not divided. */
export function forecastPoint(period: {
  label: string;
  wonMicros: string | number;
  weightedMicros: string | number;
  openMicros: string | number;
}): ForecastPoint {
  const one = (raw: string | number) => {
    const micros = forecastMicros(raw);
    if (micros == null) return { units: 0, label: 'amount not readable' };
    return { units: microsToUnits(micros), label: headlineMicrosLabel(micros, 'en-GB') };
  };
  const won = one(period.wonMicros);
  const weighted = one(period.weightedMicros);
  const open = one(period.openMicros);
  return {
    label: period.label,
    won: won.units,
    weighted: weighted.units,
    open: open.units,
    wonLabel: won.label,
    weightedLabel: weighted.label,
    openLabel: open.label,
  };
}

/** Commit target label. Null when no commit is set. */
export function forecastCommitLabel(micros: string | number | null | undefined): string | null {
  const value = forecastMicros(micros);
  if (value == null || value === 0n) return null;
  return headlineMicrosLabel(value, 'en-GB');
}

/** Currency-free amount. One compact digit is kept only when it names the same cent. */
export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (!Number.isSafeInteger(v)) return v.toLocaleString('en-GB');
  return headlineMicrosLabel(BigInt(v) * 1_000_000n, 'en-GB');
}

/** Chart hover uses the micros label when the point carries one. */
export function heroTooltipValue(
  point: { y?: number; label?: string },
  format: (n: number) => string,
): string {
  return point.label ?? format(point.y ?? 0);
}

export type OppStatus = 'open' | 'won' | 'lost';
export function oppStatus(o: OppRow): OppStatus {
  return isWon(o) ? 'won' : isLost(o) ? 'lost' : 'open';
}
