import { describe, expect, it } from 'vitest';

import { clientAbortLogFields, isExpectedClientAbortError } from './http-client-abort.js';

describe('isExpectedClientAbortError', () => {
  it('classifies Fastify response stream premature-close errors as client aborts', () => {
    expect(isExpectedClientAbortError(new Error('premature close'))).toBe(true);
    expect(
      isExpectedClientAbortError(
        Object.assign(new Error('stream closed prematurely'), {
          code: 'ERR_STREAM_PREMATURE_CLOSE',
        }),
      ),
    ).toBe(true);
  });

  it('classifies low-level socket disconnects only when the inbound request is closed', () => {
    const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

    expect(isExpectedClientAbortError(error)).toBe(false);
    expect(
      isExpectedClientAbortError(error, {
        aborted: true,
        destroyed: false,
        readableAborted: false,
      }),
    ).toBe(true);
  });

  it('walks cause chains without looping forever on malformed cyclic errors', () => {
    const root = Object.assign(new Error('outer'), { cause: undefined as unknown });
    root.cause = root;

    expect(isExpectedClientAbortError(root)).toBe(false);
  });
});

describe('clientAbortLogFields', () => {
  it('returns bounded fields instead of a full stack trace payload', () => {
    const error = Object.assign(new Error('premature close'), {
      code: 'ERR_STREAM_PREMATURE_CLOSE',
    });

    expect(clientAbortLogFields(error)).toEqual({
      errorCode: 'ERR_STREAM_PREMATURE_CLOSE',
      errorName: 'Error',
      errorMessage: 'premature close',
    });
  });
});
