import type { IncomingMessage } from 'node:http';

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  cause?: unknown;
};

type ClientAbortRequestState = Pick<
  IncomingMessage,
  'aborted' | 'destroyed' | 'readableAborted'
>;

const RESPONSE_ABORT_CODES = new Set(['ERR_STREAM_PREMATURE_CLOSE']);
const CLIENT_GONE_CODES = new Set(['ECONNRESET', 'EPIPE']);
const RESPONSE_ABORT_MESSAGES = new Set(['premature close', 'stream closed prematurely']);

function asErrorLike(error: unknown): ErrorLike | undefined {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : undefined;
}

function normalizedCode(error: ErrorLike): string | undefined {
  return typeof error.code === 'string' ? error.code : undefined;
}

function normalizedMessage(error: ErrorLike): string {
  return typeof error.message === 'string' ? error.message.trim().toLowerCase() : '';
}

function requestLooksClosed(request?: ClientAbortRequestState): boolean {
  return request?.aborted === true || request?.destroyed === true || request?.readableAborted === true;
}

export function isExpectedClientAbortError(
  error: unknown,
  request?: ClientAbortRequestState,
): boolean {
  const seen = new Set<ErrorLike>();
  let current: unknown = error;

  while (current) {
    const err = asErrorLike(current);
    if (!err || seen.has(err)) return false;
    seen.add(err);

    const code = normalizedCode(err);
    const message = normalizedMessage(err);

    if (code && RESPONSE_ABORT_CODES.has(code)) return true;
    if (RESPONSE_ABORT_MESSAGES.has(message)) return true;

    if (requestLooksClosed(request)) {
      if (code && CLIENT_GONE_CODES.has(code)) return true;
      if (message === 'socket hang up' || message === 'request aborted') return true;
      if (message.includes('client aborted') || message.includes('aborted by the client')) return true;
    }

    current = err.cause;
  }

  return false;
}

export function clientAbortLogFields(error: unknown): Record<string, unknown> {
  const err = asErrorLike(error);
  return {
    errorCode: err ? normalizedCode(err) : undefined,
    errorName: typeof err?.name === 'string' ? err.name : undefined,
    errorMessage: err ? normalizedMessage(err) : undefined,
  };
}
