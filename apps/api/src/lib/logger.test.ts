/**
 * Regression tests for the privacy-scrubbing pino hooks/serializers.
 *
 * WHY these tests: privacyLogHooks used to deep-scrub the *live* req/res/err
 * values before pino's own serializers ran, which silently dropped
 * Error.message/stack (non-enumerable) and Fastify's req/res prototype
 * getters (method/url/statusCode) from every log line touching them. These
 * tests fail if that ordering regresses, while still proving plain-string
 * and plain-object PII redaction (the pre-existing coverage) keeps working.
 */
import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { privacyLogHooks, privacyLogSerializers } from './logger.js';

function createCapturingLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino(
    { serializers: privacyLogSerializers, hooks: privacyLogHooks },
    stream,
  );
  return { logger, lines };
}

function lastEntry(lines: string[]): Record<string, unknown> {
  const line = lines.at(-1);
  if (!line) throw new Error('Expected a captured log line');
  return JSON.parse(line) as Record<string, unknown>;
}

describe('privacyLogHooks + privacyLogSerializers', () => {
  it('preserves Error message/stack instead of emitting an empty object, redacting embedded PII', () => {
    const { logger, lines } = createCapturingLogger();
    const err = new Error('failed for alice@example.com');

    logger.error({ err }, 'operation failed');

    const entry = lastEntry(lines);
    const loggedErr = entry.err as { message?: string; stack?: string };
    expect(loggedErr.message).toBe('failed for [REDACTED_EMAIL]');
    expect(loggedErr.stack).toContain('Error: failed for [REDACTED_EMAIL]');
    expect(loggedErr.stack).not.toContain('alice@example.com');
  });

  it('preserves Fastify request prototype getters (method/url) via the req serializer', () => {
    const { logger, lines } = createCapturingLogger();
    class FakeRequest {
      id = 'req-1';
      headers = { host: 'bidstack.local' };
      get method(): string {
        return 'GET';
      }
      get url(): string {
        return '/accounts/123?email=alice@example.com';
      }
    }

    logger.info({ req: new FakeRequest() }, 'incoming request');

    const entry = lastEntry(lines);
    const loggedReq = entry.req as { method?: string; url?: string };
    expect(loggedReq.method).toBe('GET');
    expect(loggedReq.url).toBe('/accounts/123?email=%5BREDACTED%5D');
  });

  it('still redacts PII in plain string messages and plain object fields', () => {
    const { logger, lines } = createCapturingLogger();

    logger.info({ contact: 'alice@example.com' }, 'contact email is alice@example.com');

    const entry = lastEntry(lines);
    expect(entry.contact).toBe('[REDACTED_EMAIL]');
    expect(entry.msg).toBe('contact email is [REDACTED_EMAIL]');
  });
});
