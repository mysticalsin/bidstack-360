// Pure derivations behind the dashboard + account visuals. Everything here is
// computed from API rows; nothing is invented. Kept pure so it is unit-tested.
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
  /** Live stage flags. A deleted row must not close the deal by itself. */
  pipelineStage?: { isWon?: boolean; isLost?: boolean; deletedAt?: string | Date | null } | null;
}

/** Lost wins over won. The stage name and a live flag both close the deal. */
function outcomeOf(row: OppRow): 'won' | 'lost' | null {
  return closedOutcome({
    stage: stageKey(row.stage),
    pipelineStage: row.pipelineStage,
  });
}

const isWon = (o: OppRow) => outcomeOf(o) === 'won';
const isLost = (o: OppRow) => outcomeOf(o) === 'lost';
const isClosed = (o: OppRow) => isWon(o) || isLost(o);
/** When a closed bid closed: closedAt when recorded, else its due date. */
export const closeDate = (o: OppRow): string | null => o.closedAt ?? o.dueDate;

/** Dates are calendar days: bucket on the UTC date so "2026-10-01" stays in Q4. */
export function quarterOf(iso: string): string {
  const d = new Date(iso);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

export function stageFunnel(rows: OppRow[]) {
  return OPEN_STAGES.map((id) => {
    const inStage = rows.filter((o) => !isClosed(o) && stageKey(o.stage) === id);
    return { label: stageText(id), value: inStage.reduce((n, o) => n + (o.value ?? 0), 0), count: inStage.length };
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
    cur.v += o.value ?? 0;
    by.set(q, cur);
  }
  return [...by.entries()].sort((a, b) => a[1].t - b[1].t).map(([label, v]) => ({ label, won: v.v }));
}

const monFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
/** Cumulative won value by close month for the year of the latest close. */
export function cumulativeWon(rows: OppRow[]) {
  const won = rows.filter(isWon).map((o) => ({ at: closeDate(o), v: o.value ?? 0 })).filter((r): r is { at: string; v: number } => Boolean(r.at));
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
    if (isWon(o)) cur.won += o.value ?? 0; else cur.open += o.value ?? 0;
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
  return [0, ...open.map((o) => (run += o.value ?? 0))];
}

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
/** Currency-free compact amount (opportunity rows carry no currency). */
export const fmtCompact = (v: number) => compact.format(v);

export type OppStatus = 'open' | 'won' | 'lost';
export function oppStatus(o: OppRow): OppStatus {
  return isWon(o) ? 'won' : isLost(o) ? 'lost' : 'open';
}
