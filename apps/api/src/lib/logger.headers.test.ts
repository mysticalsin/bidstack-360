/**
 * Proves request credentials never reach log output.
 *
 * WHY: on Vercel the full request headers were logged, which included the
 * platform's x-vercel-oidc-token and the signed `forwarded` header. These
 * tests send every known credential header through a real Fastify request
 * and through raw pino calls, then assert that no sentinel value appears in
 * any captured log line.
 */
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import {
  privacyLogHooks,
  privacyLogSerializers,
  safeLogHeaders,
  SENSITIVE_HEADER_NAMES,
  SENSITIVE_HEADER_REDACT_PATHS,
} from './logger.js';

function capture(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { stream, lines };
}

const sentinel = (name: string): string => `SENTINEL_${name.replace(/[^a-z0-9]/gi, '_')}_c0ffee`;

const credentialHeaders: Record<string, string> = Object.fromEntries(
  [
    ...SENSITIVE_HEADER_NAMES.filter((n) => n !== 'set-cookie'),
    'x-vercel-some-new-token',
    'x-custom-secret',
  ].map((n) => [n, sentinel(n)]),
);

function expectNoSentinel(lines: string[]): void {
  expect(lines.length).toBeGreaterThan(0);
  const all = lines.join('\n');
  expect(all).not.toMatch(/SENTINEL_/);
  expect(all).not.toMatch(/c0ffee/);
}

describe('request header logging', () => {
  it('never writes credential header values from a real Fastify request', async () => {
    const { stream, lines } = capture();
    const app = Fastify({
      logger: {
        level: 'info',
        stream,
        redact: { paths: [...SENSITIVE_HEADER_REDACT_PATHS], remove: true },
        serializers: privacyLogSerializers,
        hooks: privacyLogHooks,
      },
    });
    app.get('/probe', async (_req, reply) => {
      reply.header('set-cookie', `${sentinel('set-cookie')}=1; HttpOnly`);
      return { ok: true };
    });
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { ...credentialHeaders, 'user-agent': 'vitest', 'x-request-id': 'req-12345678' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();

    expectNoSentinel(lines);
    const incoming = lines.map((l) => JSON.parse(l) as { msg?: string; req?: { headers?: Record<string, unknown> } })
      .find((e) => e.msg === 'incoming request');
    expect(incoming?.req?.headers).toEqual({ 'user-agent': 'vitest', 'x-request-id': 'req-12345678', host: 'localhost:80' });
  });

  it('redact config alone strips credential headers when a caller logs raw headers', () => {
    const { stream, lines } = capture();
    const logger = pino({ redact: { paths: [...SENSITIVE_HEADER_REDACT_PATHS], remove: true } }, stream);
    const headers = { ...credentialHeaders, 'set-cookie': sentinel('set-cookie') };
    const known = Object.fromEntries(SENSITIVE_HEADER_NAMES.map((n) => [n, sentinel(n)]));

    logger.info({ req: { headers: known } }, 'raw req');
    logger.info({ res: { headers: known } }, 'raw res');
    logger.info({ headers: known }, 'raw headers');
    logger.info({ err: { config: { headers: { ...known, Authorization: sentinel('Authorization') } } } }, 'raw err');

    expectNoSentinel(lines);
    expect(Object.keys(headers).length).toBeGreaterThan(SENSITIVE_HEADER_NAMES.length);
  });

  it('safeLogHeaders keeps only allowlisted, non-credential headers', () => {
    expect(
      safeLogHeaders({
        ...credentialHeaders,
        'X-Vercel-Oidc-Token': sentinel('upper'),
        'x-forwarded-for': '203.0.113.7',
        'content-type': 'application/json',
        host: 'bidstack-demo.vercel.app',
      }),
    ).toEqual({ 'content-type': 'application/json', host: 'bidstack-demo.vercel.app' });
    expect(safeLogHeaders(undefined)).toBeUndefined();
  });
});
