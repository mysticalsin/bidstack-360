import { Link } from 'react-router-dom';
// Lean, token-styled charts on recharts (already a dependency) + plain SVG.
// Every chart: hairline axes, ≤1 dashed gridline set, subtle arrive, and
// isAnimationActive=false under prefers-reduced-motion.
import { useReducedMotion } from 'framer-motion';
import {
  Area, AreaChart, Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';

import { useState } from 'react';

import { ChartTip, SignalShape } from './ChartCard';
import { KIND_LABEL } from './viz-kinds';

const anim = (reduced: boolean | null) => ({ isAnimationActive: !reduced, animationDuration: 600, animationEasing: 'ease-out' as const });

/* ---------- sparkline (header numbers) ---------- */
export function Spark({ values, mode = 'line', hotFrom, label, width = 96, height = 24 }: {
  values: number[]; mode?: 'line' | 'bars'; hotFrom?: number; label: string; width?: number; height?: number;
}) {
  if (values.length < 2 && mode === 'line') return null;
  const max = Math.max(...values, 1);
  const min = mode === 'bars' ? 0 : Math.min(...values);
  const span = max - min || 1;
  if (mode === 'bars') {
    const w = width / values.length;
    return (
      <svg className="viz-spark" width={width} height={height} role="img" aria-label={label}>
        {values.map((v, i) => {
          const h = Math.max(2, (v / max) * (height - 2));
          return <rect key={i} x={i * w + 1} y={height - h} width={Math.max(2, w - 3)} height={h} rx={1.5} data-hot={hotFrom !== undefined && i >= hotFrom && v > 0} />;
        })}
      </svg>
    );
  }
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg className="viz-spark" width={width} height={height} role="img" aria-label={label}>
      <path className="area" d={`${line} L${width} ${height} L0 ${height} Z`} />
      <path className="line viz-draw" pathLength={1} d={line} />
    </svg>
  );
}

/* ---------- horizontal stage bars (pipeline funnel) ---------- */
export function StageBars({ data, format, height, onSelect }: {
  data: Array<{ label: string; value: number; count: number }>; format: (v: number) => string; height?: number;
  /** Pointer shortcut; callers must also offer a keyboard path (chips, table). */
  onSelect?: (label: string) => void;
}) {
  const reduced = useReducedMotion();
  const h = height ?? Math.max(72, data.length * 44 + 16);
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={10}
        style={onSelect ? { cursor: 'pointer' } : undefined}
        onClick={onSelect ? (st: { activeLabel?: string | number } | null) => { if (st?.activeLabel !== undefined) onSelect(String(st.activeLabel)); } : undefined}>
        <XAxis type="number" hide domain={[0, max]} />
        <YAxis type="category" dataKey="label" width={132} tickLine={false} axisLine={{ stroke: 'var(--viz-line)' }} />
        <Tooltip cursor={{ fill: 'var(--surface-sunken, #f4f4f4)' }} content={<ChartTip format={format} />} />
        <Bar dataKey="value" name="Value" radius={[0, 4, 4, 0]} maxBarSize={28} {...anim(reduced)}
          label={{ position: 'right', formatter: (v: unknown) => format(Number(v)), fill: 'var(--viz-muted)', fontSize: 12 }}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={`color-mix(in srgb, var(--brand-primary, #006b4f) ${90 - i * (50 / Math.max(1, data.length - 1))}%, transparent)`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ---------- won/lost by year ---------- */
export function YearBars({ data, format, height = 160 }: { data: Array<{ year: string; won: number; lost: number }>; format: (v: number) => string; height?: number }) {
  const reduced = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barGap={4} barCategoryGap="30%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: 'var(--viz-line)' }} />
        <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v) => format(Number(v))} />
        <Tooltip cursor={{ fill: 'var(--surface-sunken, #f4f4f4)' }} content={<ChartTip format={format} />} />
        <Bar dataKey="won" name="Won" fill="color-mix(in srgb, var(--success, #177048) 75%, transparent)" radius={[4, 4, 0, 0]} maxBarSize={36} {...anim(reduced)} />
        <Bar dataKey="lost" name="Lost" fill="color-mix(in srgb, var(--fg-tertiary, #6b6b6b) 30%, transparent)" radius={[4, 4, 0, 0]} maxBarSize={36} {...anim(reduced)} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ---------- signals on a time axis ---------- */
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' });
export function SignalStrip({ events, from, to }: {
  events: Array<{ id: string; at: string; kind: string; title: string }>; from: Date; to: Date;
}) {
  // Room for MAX_LANES stacked markers above the axis, all inside the viewBox,
  // so a busy day never spills into the card header. Extra markers on the
  // same day collapse into a "+N" count (the list below has every signal).
  const W = 400, H = 64, pad = 8, AXIS = 44, LANE = 11, MAX_LANES = 3;
  const t0 = from.getTime(), t1 = to.getTime();
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
  const months: Date[] = [];
  const m = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  while (m.getTime() <= t1) { months.push(new Date(m)); m.setMonth(m.getMonth() + 1); }
  const lanes = new Map<number, number>();
  const overflow = new Map<number, { px: number; n: number }>();
  const placed: Array<{ e: (typeof events)[number]; px: number; lane: number }> = [];
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (t < t0 || t > t1) continue;
    const px = x(t);
    const bucket = Math.round(px / 10);
    const lane = lanes.get(bucket) ?? 0;
    lanes.set(bucket, lane + 1);
    if (lane < MAX_LANES) placed.push({ e, px, lane });
    else overflow.set(bucket, { px, n: (overflow.get(bucket)?.n ?? 0) + 1 });
  }
  return (
    <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`}>
      <line className="axis" x1={pad} x2={W - pad} y1={AXIS} y2={AXIS} />
      {months.map((d) => (
        <g key={d.toISOString()}>
          <line className="axis" x1={x(d.getTime())} x2={x(d.getTime())} y1={AXIS - 3} y2={AXIS + 3} />
          <text className="tick" x={x(d.getTime())} y={H - 3} textAnchor="middle">{monthFmt.format(d)}</text>
        </g>
      ))}
      {placed.map(({ e, px, lane }, i) => (
        <g key={e.id}>
          <title>{`${KIND_LABEL[e.kind] ?? e.kind}: ${e.title}`}</title>
          <SignalShape kind={e.kind} x={px} y={AXIS - 12 - lane * LANE} r={5} i={i} />
        </g>
      ))}
      {[...overflow.values()].map((o) => (
        <text key={o.px} className="tick" x={o.px + 24 > W ? o.px - 8 : o.px + 8} y={AXIS - 12 - (MAX_LANES - 1) * LANE + 3} textAnchor={o.px + 24 > W ? 'end' : 'start'}>
          +{o.n}
        </text>
      ))}
    </svg>
  );
}

/* ---------- month mini calendar ---------- */
const longMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
export function MiniCalendar({ month, marks }: { month: Date; marks: Array<{ date: string; label: string }> }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday first
  const today = new Date();
  const byDay = new Map<number, string[]>();
  for (const mk of marks) {
    const d = new Date(mk.date);
    if (d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth()) {
      byDay.set(d.getDate(), [...(byDay.get(d.getDate()) ?? []), mk.label]);
    }
  }
  return (
    <div>
      <div className="viz-meta" style={{ marginBottom: 8 }}>{longMonth.format(first)}</div>
      <div className="viz-cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="dow" aria-hidden>{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1;
          const isToday = today.getFullYear() === first.getFullYear() && today.getMonth() === first.getMonth() && today.getDate() === day;
          const mark = byDay.get(day);
          return (
            <span key={day} className={`in${isToday ? ' today' : ''}${mark ? ' mark' : ''}`} title={mark?.join(', ')}>
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- earnings strip (next N days) ---------- */
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
export function EarningsStrip({ items, days }: { items: Array<{ id: string; date: string; label: string }>; days: number }) {
  const W = 400, H = 64, pad = 12;
  const [t0] = useState(() => Date.now());
  const t1 = t0 + days * 86_400_000;
  const x = (t: number) => pad + ((t - t0) / (t1 - t0)) * (W - pad * 2);
  const weeks = Array.from({ length: Math.floor(days / 7) + 1 }, (_, i) => t0 + i * 7 * 86_400_000);
  return (
    <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`}>
      <line className="axis" x1={pad} x2={W - pad} y1={40} y2={40} />
      {weeks.map((t, i) => (
        <g key={t}>
          <line className="axis" x1={x(t)} x2={x(t)} y1={37} y2={43} />
          <text className="tick" x={x(t)} y={58} textAnchor={i === 0 ? 'start' : 'middle'}>{i === 0 ? 'Today' : dayFmt.format(new Date(t))}</text>
        </g>
      ))}
      {items.map((it, i) => {
        const px = x(new Date(it.date).getTime());
        return (
          <g key={it.id}>
            <title>{`${dayFmt.format(new Date(it.date))}: ${it.label}`}</title>
            <rect className="viz-pop" style={{ '--i': i, fill: 'var(--viz-brand)' } as React.CSSProperties} x={px - 4} y={32} width={8} height={16} rx={2} />
            <text className="tick" x={px} y={22} textAnchor="middle" style={{ fill: 'var(--viz-ink)' }}>{it.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- trend area (hero) ---------- */
export function TrendArea({ data, format, height = 120 }: { data: Array<{ x: string; y: number }>; format: (v: number) => string; height?: number }) {
  const reduced = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="viz-hero" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-primary, #006b4f)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--brand-primary, #006b4f)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="x" tickLine={false} axisLine={{ stroke: 'var(--viz-line)' }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip content={<ChartTip format={format} />} />
        <Area type="monotone" dataKey="y" name="Open pipeline" stroke="var(--brand-primary, #006b4f)" strokeWidth={1.75} fill="url(#viz-hero)" {...anim(reduced)} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ---------- win rate over time ---------- */
export function RateLine({ data }: { data: Array<{ x: string; rate: number }> }) {
  const reduced = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="x" tickLine={false} axisLine={{ stroke: 'var(--viz-line)' }} minTickGap={16} />
        <YAxis width={40} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
        <ReferenceLine y={50} stroke="var(--viz-line)" />
        <Tooltip content={<ChartTip format={(v) => `${v}%`} />} />
        <Line type="monotone" dataKey="rate" name="Win rate" stroke="var(--brand-primary, #006b4f)" strokeWidth={1.75}
          dot={{ r: 3, fill: 'var(--surface-card, #fff)', strokeWidth: 1.5 }} {...anim(reduced)} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ---------- donut ---------- */
export function Donut({ data, center, centerLabel }: {
  data: Array<{ label: string; value: number; color: string }>; center: string; centerLabel: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0,1fr)', gap: 24, alignItems: 'center' }}>
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} outerRadius={66} paddingAngle={2} stroke="none" {...anim(reduced)}>
              {data.map((d) => <Cell key={d.label} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
          <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--viz-ink)' }}>{center}</span>
          <span className="viz-meta" style={{ fontSize: 12 }}>{centerLabel}</span>
        </div>
      </div>
      <ul className="viz-legend" style={{ display: 'grid', gap: 8 }}>
        {data.map((d, i) => (
          <li key={d.label} style={{ justifyContent: 'space-between', gap: 16 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {/* shape varies with colour so the legend works without colour */}
              <svg width="10" height="10" aria-hidden>{i % 3 === 0 ? <circle cx="5" cy="5" r="4" fill={d.color} /> : i % 3 === 1 ? <rect x="1" y="1" width="8" height="8" fill={d.color} /> : <path d="M5 1 L9 9 L1 9 Z" fill={d.color} />}</svg>
              {d.label}
            </span>
            <span style={{ color: 'var(--viz-ink)', fontVariantNumeric: 'tabular-nums' }}>{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- horizontal bars (top accounts) ---------- */
export function HBars({ data, format, onSelect }: {
  data: Array<{ label: string; open: number; won: number; openLabel?: string; wonLabel?: string; totalLabel?: string }>;
  format: (v: number) => string;
  /** Pointer shortcut into a drill; keyboard users get the same via the card's drill list. */
  onSelect?: (label: string) => void;
}) {
  const reduced = useReducedMotion();
  const labeled = data.some((d) => d.totalLabel);
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 36 + 8)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={8}
        style={onSelect ? { cursor: 'pointer' } : undefined}
        onClick={onSelect ? (st: { activeLabel?: string | number } | null) => { if (st?.activeLabel !== undefined) onSelect(String(st.activeLabel)); } : undefined}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={150} tickLine={false} axisLine={{ stroke: 'var(--viz-line)' }}
          tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
        <Tooltip cursor={{ fill: 'var(--surface-sunken, #f4f4f4)' }} content={labeled ? <AccountBarTip rows={data} /> : <ChartTip format={format} />} />
        <Bar dataKey="won" name="Won" stackId="a" fill="color-mix(in srgb, var(--success, #177048) 75%, transparent)" {...anim(reduced)} />
        <Bar dataKey="open" name="Open" stackId="a" fill="color-mix(in srgb, var(--brand-primary, #006b4f) 22%, transparent)" radius={[0, 4, 4, 0]} {...anim(reduced)}
          label={{ position: 'right', formatter: (_: unknown, __?: unknown, i?: number) => (i !== undefined && data[i] ? (data[i].totalLabel ?? format(data[i].open + data[i].won)) : ''), fill: 'var(--viz-muted)', fontSize: 12 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AccountBarTip({ active, label, rows }: {
  active?: boolean;
  label?: string | number;
  rows: Array<{ label: string; openLabel?: string; wonLabel?: string }>;
}) {
  if (!active || label === undefined) return null;
  const row = rows.find((d) => d.label === String(label));
  if (!row) return null;
  return (
    <div className="viz-tip">
      <div style={{ marginBottom: 4 }}><b>{label}</b></div>
      <div>Won: {row.wonLabel}</div>
      <div>Open: {row.openLabel}</div>
    </div>
  );
}

/* ---------- forecast vs target ---------- */
export function TargetBars({ data, format, target }: {
  data: Array<{ label: string; weighted: number; won: number; open: number }>; format: (v: number) => string; target: number | null;
}) {
  const reduced = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barGap={4} barCategoryGap="28%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--viz-line)' }} />
        <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v) => format(Number(v))} />
        <Tooltip cursor={{ fill: 'var(--surface-sunken, #f4f4f4)' }} content={<ChartTip format={format} />} />
        {target ? <ReferenceLine y={target} stroke="var(--viz-ink)" strokeDasharray="4 4" label={{ value: 'Target', position: 'insideTopRight', fill: 'var(--viz-muted)', fontSize: 12 }} /> : null}
        <Bar dataKey="weighted" name="Weighted" fill="color-mix(in srgb, var(--brand-primary, #006b4f) 70%, transparent)" radius={[4, 4, 0, 0]} maxBarSize={32} {...anim(reduced)} />
        <Bar dataKey="won" name="Won" fill="var(--success, #177048)" radius={[4, 4, 0, 0]} maxBarSize={32} {...anim(reduced)} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ---------- watchdog heat strip ---------- */
export function HeatStrip({ rows, weeks, rowHref }: {
  rows: Array<{ id: string; name: string; cells: Array<{ kind: string | null; count: number }> }>; weeks: string[];
  rowHref?: (id: string) => string;
}) {
  return (
    <div className="viz-heat">
      {rows.map((r) => (
        <div key={r.id} className="viz-heat-row">
          {rowHref ? (
            <Link className="viz-heat-name viz-heat-link" title={r.name} to={rowHref(r.id)}>{r.name}</Link>
          ) : (
            <span className="viz-heat-name" title={r.name}>{r.name}</span>
          )}
          <span className="viz-heat-cells">
            {r.cells.map((c, i) => (
              <i key={i} data-kind={c.kind ?? undefined} style={{ '--a': Math.min(85, 25 + c.count * 20) } as React.CSSProperties}
                title={`${weeks[i]}: ${c.count} signal${c.count === 1 ? '' : 's'}${c.kind ? ` (worst: ${KIND_LABEL[c.kind]})` : ''}`} />
            ))}
          </span>
        </div>
      ))}
      <div className="viz-heat-row" aria-hidden>
        <span />
        <span className="viz-heat-cells viz-meta" style={{ fontSize: 11 }}>
          {weeks.map((w, i) => <span key={i} style={{ textAlign: 'center' }}>{i % 2 === 0 ? w : ''}</span>)}
        </span>
      </div>
    </div>
  );
}
