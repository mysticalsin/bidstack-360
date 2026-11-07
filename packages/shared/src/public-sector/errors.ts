/** Why a source call failed. Drives retry, pause and audit decisions. */
export type PsSourceErrorKind =
  | 'auth'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'outside_quiet_hours'
  | 'redirect_refused'
  | 'blocked_url'
  | 'too_large'
  | 'network'
  | 'http'
  | 'schema';

/**
 * A source failure. Messages are built from redacted URLs only and never
 * carry an underlying error as `cause`, so a credential in a request URL
 * cannot leak through logs or job payloads.
 */
export class PsSourceError extends Error {
  readonly kind: PsSourceErrorKind;
  readonly doNotRetry: boolean;
  readonly retryAfterMs: number | null;
  readonly httpStatus: number | null;

  constructor(
    kind: PsSourceErrorKind,
    message: string,
    opts: { doNotRetry?: boolean; retryAfterMs?: number | null; httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = 'PsSourceError';
    this.kind = kind;
    this.doNotRetry = opts.doNotRetry ?? false;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.httpStatus = opts.httpStatus ?? null;
  }

  /** Safe, credential-free shape for job results and audit metadata. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      doNotRetry: this.doNotRetry,
      retryAfterMs: this.retryAfterMs,
      httpStatus: this.httpStatus,
    };
  }
}
