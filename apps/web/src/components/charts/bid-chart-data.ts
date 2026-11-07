// Pure mappers from existing API payloads to the TUFFUI bid charts. Nothing
// here invents data: every bar, dot and spoke is a sum or count of real rows.
import { BID_CRITERIA, BID_THRESHOLDS } from '@bidstack/shared';

import { closeDate, oppStatus, type OppRow } from '@/components/viz/viz-data';

/** A closed bid that took longer than this from opening to outcome is flagged. */
export const SALES_CYCLE_OVERDUE_DAYS = 90;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' as 'Sep 2026' (fixed English labels, same on server and client). */
export function closeMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : key;
}

const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Bids by close month: won, lost and open stacked above the axis, the overdue
 * part of open hanging below. The window runs from 11 months back to 12
 * months ahead and is trimmed to the months that hold bids.
 */
export function pipelineByCloseMonth(rows: OppRow[], now = Date.now()) {
  const today = new Date(now);
  const start = today.getUTCFullYear() * 12 + today.getUTCMonth() - 11;
  const end = start + 23;
  const buckets = new Map<number, { won: number; lost: number; open: number; overdue: number }>();
  for (const o of rows) {
    const iso = closeDate(o);
    if (!iso) continue;
    const d = new Date(iso);
    const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (Number.isNaN(idx) || idx < start || idx > end) continue;
    const b = buckets.get(idx) ?? { won: 0, lost: 0, open: 0, overdue: 0 };
    const v = o.value ?? 0;
    const status = oppStatus(o);
    if (status === 'won') b.won += v;
    else if (status === 'lost') b.lost += v;
    else {
      b.open += v;
      if (o.dueDate && new Date(o.dueDate).getTime() < now) b.overdue += v;
    }
    buckets.set(idx, b);
  }
  const out = { keys: [] as string[], labels: [] as string[], won: [] as number[], lost: [] as number[], open: [] as number[], overdue: [] as number[] };
  if (!buckets.size) return out;
  const idxs = [...buckets.keys()];
  const first = Math.min(...idxs);
  const last = Math.max(...idxs);
  for (let i = first; i <= last; i++) {
    const y = Math.floor(i / 12);
    const m = i % 12;
    const b = buckets.get(i) ?? { won: 0, lost: 0, open: 0, overdue: 0 };
    out.keys.push(monthKey(y, m));
    out.labels.push(i === first || m === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m]!);
    out.won.push(round2(b.won));
    out.lost.push(round2(b.lost));
    out.open.push(round2(b.open));
    out.overdue.push(round2(b.overdue));
  }
  return out;
}

const ACTIVITY_KINDS = [
  { id: 'call', label: 'Calls', types: ['call'] },
  { id: 'email', label: 'Emails', types: ['email', 'email_opened', 'email_clicked'] },
  { id: 'meeting', label: 'Meetings', types: ['meeting'] },
] as const;

export interface ActivityLike {
  occurredAt: string;
  type: string;
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

function hourIn(iso: string, timeZone: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const part = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone })
    .formatToParts(d)
    .find((p) => p.type === 'hour');
  const h = Number(part?.value);
  return Number.isInteger(h) && h >= 0 && h < 24 ? h : null;
}

/** Activity count per hour of day in the viewer's zone, one series per kind. */
export function activityByHour(items: readonly ActivityLike[], timeZone: string) {
  const series = [...ACTIVITY_KINDS.map((k) => ({ id: k.id as string, label: k.label as string })), { id: 'other', label: 'Other' }].map(
    (s) => ({ ...s, values: new Array<number>(24).fill(0) }),
  );
  let total = 0;
  for (const it of items) {
    const h = hourIn(it.occurredAt, timeZone);
    if (h === null) continue;
    const kind = ACTIVITY_KINDS.findIndex((k) => (k.types as readonly string[]).includes(it.type));
    series[kind === -1 ? series.length - 1 : kind]!.values[h]! += 1;
    total += 1;
  }
  return { labels: HOUR_LABELS, series: series.filter((s) => s.values.some((v) => v > 0)), total };
}

/** Win prediction drivers, strongest push for the win first. */
export function winFactorRows(drivers: readonly { label: string; contribution: number }[]) {
  return drivers
    .map((d) => ({ label: d.label, value: round2(d.contribution) }))
    .sort((a, b) => b.value - a.value);
}

/** Go threshold per criterion on the 0 to 5 scale (the bid threshold is a percentage). */
const GO_RATING = round2((BID_THRESHOLDS.bid / 100) * 5);

/** Registry criteria as radar axes; unrated criteria sit at 0. */
export function bidCriteriaRadar(criteria: Readonly<Record<string, number>>) {
  const axes = BID_CRITERIA.map((c) => c.label);
  const values = BID_CRITERIA.map((c) => round2(criteria[c.id] ?? 0));
  const rated = BID_CRITERIA.filter((c) => typeof criteria[c.id] === 'number').length;
  return { axes, values, baseline: axes.map(() => GO_RATING), rated };
}

/** API quarters ("2026-Q1") as chart labels ("Q1 2026"), won above and lost below. */
export function winLossQuarterBars(quarters: readonly { quarter: string; won: number; lost: number }[]) {
  return {
    labels: quarters.map((q) => {
      const [y, qq] = q.quarter.split('-');
      return qq && y ? `${qq} ${y}` : q.quarter;
    }),
    won: quarters.map((q) => q.won),
    lost: quarters.map((q) => q.lost),
  };
}

function sectorLabel(code: string | null | undefined): string {
  if (!code) return 'Unclassified';
  const words = code.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : 'Unclassified';
}

/** Open value per sector (back row) with its overdue part (front row), biggest first. */
export function sectorPipeline(rows: readonly (OppRow & { industry?: string | null })[], now = Date.now(), top = 6) {
  const by = new Map<string, { open: number; overdue: number }>();
  for (const o of rows) {
    if (oppStatus(o) !== 'open') continue;
    const label = sectorLabel(o.industry);
    const b = by.get(label) ?? { open: 0, overdue: 0 };
    const v = o.value ?? 0;
    b.open += v;
    if (o.dueDate && new Date(o.dueDate).getTime() < now) b.overdue += v;
    by.set(label, b);
  }
  const sorted = [...by.entries()].sort((a, b) => b[1].open - a[1].open || a[0].localeCompare(b[0])).slice(0, top);
  return {
    labels: sorted.map(([l]) => l),
    open: sorted.map(([, b]) => round2(b.open)),
    overdue: sorted.map(([, b]) => round2(b.overdue)),
  };
}

/** Forecast periods in whole units: won, weighted open, and the unweighted rest of open. */
export function forecastPeriodBars(
  periods: readonly { label: string; openMicros: number; weightedMicros: number; wonMicros: number }[],
) {
  const kept = periods.filter((p) => p.openMicros > 0 || p.weightedMicros > 0 || p.wonMicros > 0);
  const units = (m: number) => round2(m / 1_000_000);
  return {
    labels: kept.map((p) => p.label),
    won: kept.map((p) => units(p.wonMicros)),
    weighted: kept.map((p) => units(p.weightedMicros)),
    unweighted: kept.map((p) => units(Math.max(0, p.openMicros - p.weightedMicros))),
  };
}
