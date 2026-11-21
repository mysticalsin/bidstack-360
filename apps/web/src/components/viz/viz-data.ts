// Pure derivations behind the dashboard + account visuals. Everything here is
// computed from API rows; nothing is invented. Kept pure so it is unit-tested.
import { formatMicrosDecimal, microsToUnits, unitsToMicros } from '@bidstack/shared';

import { LEGACY_PIPELINE_STAGES } from '@/lib/pipeline-stages';

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
  /** Integer micros. Used when the unit number has already lost the amount. */
  valueMicros?: string | null;
}

/** Chart units from integer micros when the row has them, otherwise the unit number. */
export function chartUnits(row: { value?: number | null; valueMicros?: string | null }): number {
  const raw = row.valueMicros;
  if (raw != null && /^-?\d+$/.test(raw)) {
    const micros = BigInt(raw);
    const whole = micros / 1_000_000n;
    const absWhole = whole < 0n ? -whole : whole;
    if (absWhole <= BigInt(Number.MAX_SAFE_INTEGER)) {
      const remainder = micros % 1_000_000n;
      return Number(whole) + Number(remainder) / 1_000_000;
    }
  }
  return row.value ?? 0;
}

const isWon = (o: OppRow) => stageKey(o.stage) === 'closed_won';
const isLost = (o: OppRow) => stageKey(o.stage) === 'closed_lost';
const isClosed = (o: OppRow) => isWon(o) || isLost(o);
/** When a closed bid closed: closedAt when recorded, else its due date. */
export const closeDate = (o: OppRow): string | null => o.closedAt ?? o.dueDate;

/** Dates are calendar days: bucket on the UTC date so "2026-10-01" stays in Q4. */
export function quarterOf(iso: string): string {
  const d = new Date(iso);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/** Integer micros for a row. The digit string wins. A unit number is used only when it converts exactly. */
function rowMicros(row: { value?: number | null; valueMicros?: string | null }): bigint | null {
  const raw = row.valueMicros;
  if (raw != null && raw !== '' && /^-?\d+$/.test(raw)) return BigInt(raw);
  if (row.value == null || !Number.isFinite(row.value)) return 0n;
  if (Math.abs(row.value) > Number.MAX_SAFE_INTEGER) return null;
  try {
    return unitsToMicros(row.value);
  } catch {
    return null;
  }
}

/** Bar length. Zero when the micros total does not fit in a JavaScript number. */
function layoutUnits(micros: bigint): number {
  const whole = micros / 1_000_000n;
  const abs = whole < 0n ? -whole : whole;
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
  return microsToUnits(micros);
}

/** Exact major-unit text. A total that fits keeps the compact chart label. */
function stageAmount(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const abs = whole < 0n ? -whole : whole;
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return formatMicrosDecimal(micros);
  return fmtCompact(layoutUnits(micros));
}

export function stageFunnel(rows: OppRow[]) {
  return OPEN_STAGES.map((id) => {
    const inStage = rows.filter((o) => stageKey(o.stage) === id);
    let micros = 0n;
    let readable = true;
    for (const row of inStage) {
      const part = rowMicros(row);
      if (part == null) {
        readable = false;
        break;
      }
      micros += part;
    }
    return {
      label: stageText(id),
      value: readable ? layoutUnits(micros) : inStage.reduce((n, o) => n + chartUnits(o), 0),
      amount: readable ? stageAmount(micros) : 'amount not readable',
      count: inStage.length,
    };
  }).filter((s) => s.count > 0);
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
  const by = new Map<string, { v: number; t: number }>();
  for (const o of rows.filter(isWon)) {
    const at = closeDate(o);
    if (!at) continue;
    const q = quarterOf(at);
    const cur = by.get(q) ?? { v: 0, t: new Date(at).getTime() };
    cur.v += chartUnits(o);
    by.set(q, cur);
  }
  return [...by.entries()].sort((a, b) => a[1].t - b[1].t).map(([label, v]) => ({ label, won: v.v }));
}

const monFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
/** Cumulative won value by close month for the year of the latest close. */
export function cumulativeWon(rows: OppRow[]) {
  const won = rows.filter(isWon).map((o) => ({ at: closeDate(o), v: chartUnits(o) })).filter((r): r is { at: string; v: number } => Boolean(r.at));
  if (!won.length) return [];
  const year = Math.max(...won.map((r) => new Date(r.at).getUTCFullYear()));
  const lastMonth = Math.max(...won.filter((r) => new Date(r.at).getUTCFullYear() === year).map((r) => new Date(r.at).getUTCMonth()));
  let run = 0;
  return Array.from({ length: lastMonth + 1 }, (_, m) => {
    run += won.filter((r) => { const d = new Date(r.at); return d.getUTCFullYear() === year && d.getUTCMonth() === m; }).reduce((n, r) => n + r.v, 0);
    const date = new Date(year, m, 1); // local midnight, for axis display only
    return { x: monFmt.format(date), date, y: run };
  });
}

/** Per-account open vs won value, top N by total. */
export function accountBars(rows: OppRow[], n = 6) {
  const by = new Map<string, { open: number; won: number }>();
  for (const o of rows) {
    if (!o.customer || isLost(o)) continue;
    const cur = by.get(o.customer) ?? { open: 0, won: 0 };
    if (isWon(o)) cur.won += chartUnits(o); else cur.open += chartUnits(o);
    by.set(o.customer, cur);
  }
  return [...by.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.open + b.won - (a.open + a.won))
    .slice(0, n);
}

/** Open bids whose due date has already passed. */
export function pastDueOpen(rows: OppRow[], now = Date.now()) {
  return rows.filter((o) => !isClosed(o) && o.dueDate && new Date(o.dueDate).getTime() < now);
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
  let run = 0;
  return [0, ...open.map((o) => (run += chartUnits(o)))];
}

const chartCompact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 2 });
const chartCompactRounded = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

/** True when two fraction digits still name this unit count. */
function compactKeepsUnits(units: number): boolean {
  const abs = Math.abs(units);
  for (const div of [1e9, 1e6, 1e3]) {
    if (abs < div) continue;
    for (let digits = 0; digits <= 2; digits += 1) {
      if (Number((abs / div).toFixed(digits)) * div === abs) return true;
    }
    return false;
  }
  return false;
}

/**
 * Currency-free amount. Two digits when they name the same unit (7.86m, 11.89m).
 * Otherwise one digit, including fractions. The full figure wrapped the hero.
 */
export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return chartCompactRounded.format(v);
  if (Number.isSafeInteger(v) && !compactKeepsUnits(v)) {
    const sign = v < 0 ? '-' : '';
    return `${sign}${Math.abs(v).toLocaleString('en-GB')}`;
  }
  if (!compactKeepsUnits(v)) return chartCompactRounded.format(v);
  return chartCompact.format(v);
}

export function forecastAmount(period: {
  wonMicros: string | number;
  weightedMicros: string | number;
  openMicros: string | number;
}): { won: number; weighted: number; open: number; wonLabel: string; weightedLabel: string; openLabel: string } {
  const one = (raw: string | number) => {
    if (typeof raw === 'number' && !Number.isSafeInteger(raw)) {
      return { units: 0, label: 'amount not readable' };
    }
    if (typeof raw === 'string' && !/^-?\d+$/.test(raw)) {
      return { units: 0, label: 'amount not readable' };
    }
    const micros = BigInt(raw);
    const whole = micros / 1_000_000n;
    const absWhole = whole < 0n ? -whole : whole;
    if (absWhole > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { units: 0, label: formatMicrosDecimal(micros) };
    }
    const remainder = micros % 1_000_000n;
    const units = Number(whole) + Number(remainder) / 1_000_000;
    return { units, label: fmtCompact(units) };
  };
  const won = one(period.wonMicros);
  const weighted = one(period.weightedMicros);
  const open = one(period.openMicros);
  return {
    won: won.units,
    weighted: weighted.units,
    open: open.units,
    wonLabel: won.label,
    weightedLabel: weighted.label,
    openLabel: open.label,
  };
}

export type OppStatus = 'open' | 'won' | 'lost';
export function oppStatus(o: OppRow): OppStatus {
  return isWon(o) ? 'won' : isLost(o) ? 'lost' : 'open';
}
