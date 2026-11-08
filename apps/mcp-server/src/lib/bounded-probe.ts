// Readiness probes must answer quickly when a dependency hangs (network
// partition, exhausted pool) instead of holding /health open until the
// platform's own probe timeout fires.

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

export function probeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.HEALTH_PROBE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROBE_TIMEOUT_MS;
}

/**
 * Resolves the probe's boolean result, or false when it rejects or does not
 * settle within `timeoutMs`. A probe resolving a non-boolean counts as up.
 */
export async function boundedProbe(probe: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      probe().then(
        (value) => value !== false,
        () => false,
      ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
