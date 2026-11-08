/** Host of an endpoint URL, or the raw string when it does not parse. */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 140 -> "140 ms", 1200 -> "1.2 s". */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} s`;
}

/** 30000 -> "30s", 60000 -> "1m", 90000 -> "1m 30s", 3600000 -> "1h". */
export function formatDelay(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [h ? `${h}h` : '', m ? `${m}m` : '', s ? `${s}s` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0s';
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
