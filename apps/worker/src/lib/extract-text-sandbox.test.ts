// Sandbox tests for extractTextFromBufferSandboxed.
//
// Threat being verified: a malformed input that crashes / OOMs / loops the
// parser MUST NOT bring down the parent worker process. Pre-fix code called
// pdf-parse directly in the queue worker; an attacker who got a malicious
// PDF past the upload validator could OOM the entire BullMQ consumer.
//
// We test three failure modes:
//   1. Parser throws — sandbox returns a rejected promise, parent stays
//      alive (proven by subsequent extractions still working).
//   2. Parser exceeds the wall-clock timeout — sandbox terminates the
//      worker and the parent sees a timeout error.
//   3. Plain-text happy path — sandbox passes the buffer through
//      correctly and returns the original UTF-8 text.

import { describe, expect, it } from 'vitest';

import { EXTRACT_TIMEOUT_MS, extractTextFromBufferSandboxed } from './extract-text-sandbox.js';

describe('extractTextFromBufferSandboxed', () => {
  it('returns plain UTF-8 text through the sandbox round-trip', async () => {
    // Sanity check: the happy path must still work end-to-end through
    // worker_thread creation, message passing, and buffer transfer.
    const original = 'Mandatory: deliver pricing workbook by Friday';
    const text = await extractTextFromBufferSandboxed({
      buffer: Buffer.from(original),
      contentType: 'text/plain',
      name: 'rfp.txt',
    });
    expect(text).toBe(original);
  });

  it('isolates parser failures so the parent process keeps running', async () => {
    // An unsupported content-type makes the worker throw a structured error
    // (not a native parser crash — we don't want a flaky test that depends
    // on pdf-parse's specific failure mode). The sandbox must surface this
    // as a normal rejection. We then run a second successful extraction to
    // prove the parent process is still healthy.
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    await expect(
      extractTextFromBufferSandboxed({
        buffer: garbage,
        contentType: 'application/x-totally-fake-binary',
        name: 'malicious.unknown',
      }),
    ).rejects.toThrow(/Document extraction (failed in sandbox|worker)/);

    // If the parent had crashed during the failed extraction, this call
    // would either hang or throw a different IPC error.
    const recover = await extractTextFromBufferSandboxed({
      buffer: Buffer.from('ok, still alive'),
      contentType: 'text/plain',
      name: 'after.txt',
    });
    expect(recover).toBe('ok, still alive');
  }, 30_000);

  it('terminates the worker when the parser exceeds the sandbox timeout', async () => {
    // Force a tiny 1ms timeout against a payload that the worker would
    // happily process. The timer fires before the worker can even spin up
    // its handler, so the sandbox terminates it and surfaces a timeout
    // error. We use a content-type the parser supports so that, in the
    // absence of the timer, the call would succeed — proving the timeout
    // is the load-bearing mechanism here.
    const err: unknown = await extractTextFromBufferSandboxed(
      { buffer: Buffer.from('hello'), contentType: 'text/plain', name: 'h.txt' },
      { timeoutMs: 1 },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/sandbox timeout|exited with code/);
  }, 10_000);

  it('exports a non-zero default timeout', () => {
    // Regression guard: a developer who accidentally sets the timeout to 0
    // would disable the wall-clock guard entirely. Lock the default at the
    // contract value the runbook documents.
    expect(EXTRACT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
