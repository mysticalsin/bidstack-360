const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

export class ProviderTimeoutError extends Error {
  readonly statusCode = 504;
  readonly code = 'PROVIDER_HTTP_TIMEOUT';

  constructor(
    readonly provider: string,
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`${provider} ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
  }
}

export function parseTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.trunc(parsed);
}

export function providerTimeoutMs(
  envName: string,
  fallbackMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): number {
  return parseTimeoutMs(process.env[envName], fallbackMs);
}

export function isProviderTimeoutError(err: unknown): err is ProviderTimeoutError {
  return (
    err instanceof ProviderTimeoutError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 'PROVIDER_HTTP_TIMEOUT')
  );
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export type FetchWithTimeoutInit = FetchInit & {
  provider: string;
  operation?: string;
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  input: FetchInput,
  init: FetchWithTimeoutInit,
): Promise<Response> {
  const {
    provider,
    operation = 'request',
    timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    signal,
    ...fetchInit
  } = init;

  const boundedTimeoutMs = parseTimeoutMs(String(timeoutMs), DEFAULT_PROVIDER_TIMEOUT_MS);
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, boundedTimeoutMs);

  try {
    return await fetch(input, { ...fetchInit, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new ProviderTimeoutError(provider, operation, boundedTimeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
