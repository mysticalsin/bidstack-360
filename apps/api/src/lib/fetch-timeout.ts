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

// WHY: fetch() resolves as soon as response *headers* arrive, not once the
// body is fully read. Guards each body-consuming method so the deadline
// (and the abort it triggers) stays armed until the body actually finishes,
// instead of being disarmed the moment headers land — otherwise a provider
// that stalls mid-body can pin the caller forever inside res.json()/
// res.text()/res.arrayBuffer().
function guardBodyRead<R>(
  read: () => Promise<R>,
  clearDeadline: () => void,
  isTimedOut: () => boolean,
  provider: string,
  operation: string,
  timeoutMs: number,
): () => Promise<R> {
  return async () => {
    try {
      return await read();
    } catch (err) {
      if (isTimedOut()) {
        throw new ProviderTimeoutError(provider, operation, timeoutMs);
      }
      throw err;
    } finally {
      clearDeadline();
    }
  };
}

function guardResponseBody(
  response: Response,
  clearDeadline: () => void,
  isTimedOut: () => boolean,
  provider: string,
  operation: string,
  timeoutMs: number,
): Response {
  const guard = <R>(read: () => Promise<R>) =>
    guardBodyRead(read, clearDeadline, isTimedOut, provider, operation, timeoutMs);

  return Object.assign(response, {
    json: guard(response.json.bind(response)),
    text: guard(response.text.bind(response)),
    arrayBuffer: guard(response.arrayBuffer.bind(response)),
    blob: guard(response.blob.bind(response)),
    formData: guard(response.formData.bind(response)),
  });
}

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
  let deadlineCleared = false;

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

  // Idempotent: called either from the header-phase catch below or from the
  // body-read guard once the body settles, whichever happens first.
  const clearDeadline = () => {
    if (deadlineCleared) return;
    deadlineCleared = true;
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  };

  let response: Response;
  try {
    response = await fetch(input, { ...fetchInit, signal: controller.signal });
  } catch (err) {
    clearDeadline();
    if (timedOut) {
      throw new ProviderTimeoutError(provider, operation, boundedTimeoutMs);
    }
    throw err;
  }

  return guardResponseBody(
    response,
    clearDeadline,
    () => timedOut,
    provider,
    operation,
    boundedTimeoutMs,
  );
}
