/** Horizontal count bars as a plain list: the label and number are text, the bar is decoration. */
export function CountBars({ rows, label }: { rows: Array<{ label: string; count: number }>; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="en-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label}>
          <span className="lbl" title={r.label}>{r.label}</span>
          <span className="track" aria-hidden>
            <span className="fill" style={{ display: 'block', width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="num">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}
