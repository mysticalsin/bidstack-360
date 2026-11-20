// Readiness probe for the worker health server. A hung Postgres (network
// partition, exhausted pool) must answer 503 quickly instead of holding the
// probe open until the platform's own timeout fires.

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

export function probeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.HEALTH_PROBE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROBE_TIMEOUT_MS;
}

/** Resolves true when `probe` succeeds within `timeoutMs`, false otherwise. */
export async function boundedProbe(probe: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      probe().then(
        () => true,
        () => false,
      ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface WorkerReadiness {
  ok: boolean;
  body: { status: 'ok' | 'error'; queue: 'connected' | 'disconnected'; db: 'connected' | 'disconnected' };
}

export async function workerReadiness(
  redisStatus: string,
  dbProbe: () => Promise<unknown>,
  timeoutMs = probeTimeoutMs(),
): Promise<WorkerReadiness> {
  const redisReady = redisStatus === 'ready';
  const dbReady = await boundedProbe(dbProbe, timeoutMs);
  const ok = redisReady && dbReady;
  return {
    ok,
    body: {
      status: ok ? 'ok' : 'error',
      queue: redisReady ? 'connected' : 'disconnected',
      db: dbReady ? 'connected' : 'disconnected',
    },
  };
}
