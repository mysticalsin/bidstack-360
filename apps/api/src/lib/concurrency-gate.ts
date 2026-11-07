/**
 * Non-blocking concurrency cap for heavy endpoints (full-table exports). When
 * the gate is full the caller is refused straight away, so excess requests get
 * a fast 429 instead of every request in flight slowing down until all of them
 * time out.
 */
export interface ConcurrencyGate {
  /** A release function when a slot is free, otherwise null. Release is idempotent. */
  tryAcquire(): (() => void) | null;
  inFlight(): number;
  readonly max: number;
}

export function createConcurrencyGate(max: number): ConcurrencyGate {
  if (!Number.isInteger(max) || max < 1) throw new Error(`concurrency gate needs max >= 1, got ${max}`);
  let active = 0;
  return {
    max,
    inFlight: () => active,
    tryAcquire() {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

export function gateSizeFromEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
