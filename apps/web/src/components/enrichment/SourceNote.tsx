import { fmtAsOf } from '@/lib/enrichment/client';

/** "Source · date" under any enrichment value. */
export function SourceNote({ source, asOf, prefix }: { source: string; asOf: string; prefix?: string }) {
  return (
    <p className="en-src">
      {prefix ? `${prefix} ` : ''}{source} · <time dateTime={asOf}>{fmtAsOf(asOf)}</time>
    </p>
  );
}

export function SampleBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="en-sample" title="Illustrative data until the enrichment API is connected">Sample</span>;
}
