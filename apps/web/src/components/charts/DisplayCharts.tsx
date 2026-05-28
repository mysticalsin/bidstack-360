/**
 * DisplayCharts — HeatmapChart (CSS colour cells) and TableChart (HTML table).
 * Neither uses Recharts; both are pure layout-based data displays.
 */
import type { DataPoint } from './chartShared';

// ── HeatmapChart ──────────────────────────────────────────────────────────────

interface HeatmapProps {
  data: { label: string; value: number }[];
  columns?: number;
  'aria-label'?: string;
  maxValue?: number;
}

export function HeatmapChart({
  data,
  columns = 7,
  'aria-label': ariaLabel,
  maxValue,
}: HeatmapProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? 'Heatmap'}
      className="flex flex-wrap gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      <div className="sr-only">
        <ul>
          {data.map((d) => (
            <li key={d.label}>
              {d.label}: {d.value}
            </li>
          ))}
        </ul>
      </div>
      {data.map((d) => {
        const intensity = d.value / max;
        return (
          <div
            key={d.label}
            title={`${d.label}: ${d.value}`}
            aria-label={`${d.label}: ${d.value}`}
            className="w-4 h-4 rounded-sm transition-opacity"
            style={{
              backgroundColor: `color-mix(in srgb, var(--chart-1) ${Math.round(intensity * 100)}%, var(--border-subtle))`,
            }}
          />
        );
      })}
    </div>
  );
}

// ── TableChart ────────────────────────────────────────────────────────────────

interface TableChartProps {
  data: DataPoint[];
  columns?: { key: string; label: string }[];
  'aria-label'?: string;
}

export function TableChart({ data, columns, 'aria-label': ariaLabel }: TableChartProps) {
  const cols = columns ?? (data[0] ? Object.keys(data[0]).map((k) => ({ key: k, label: k })) : []);
  if (data.length === 0) {
    return (
      <p className="text-xs text-[var(--fg-tertiary)] py-4 text-center">No rows to display.</p>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]"
      role="region"
      aria-label={ariaLabel ?? 'Data table'}
    >
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
            {cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="px-3 py-2 text-left font-semibold text-[var(--fg-secondary)] uppercase tracking-wide"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className={i % 2 === 0 ? 'bg-[var(--surface-card)]' : 'bg-[var(--surface-sunken)]'}
            >
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 text-[var(--fg-primary)]">
                  {String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
