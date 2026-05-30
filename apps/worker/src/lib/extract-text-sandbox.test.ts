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

/**
 * Build a minimal but structurally valid single-page PDF with selectable text,
 * computing exact xref byte offsets so pdf.js (pdf-parse@2.x) parses it without
 * falling back to recovery. Kept inline so the test has no binary fixture.
 */
function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

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

  it('extracts text from a real PDF through the sandbox (pdf-parse@2.x regression guard)', async () => {
    // WHY this test exists: pdf-parse@2.x replaced its callable default export
    // with a `PDFParse` class. The old `require('pdf-parse')(buffer)` call threw
    // "pdfParse is not a function" for EVERY PDF, silently breaking all PDF
    // extraction (RFP intake, account-intel, bid-workspace). No test covered a
    // real PDF, so it went unnoticed. This locks the v2 instance API in place.
    const pdf = buildMinimalPdf('Mandatory: the vendor shall provide a pricing workbook.');
    const text = await extractTextFromBufferSandboxed({
      buffer: pdf,
      contentType: 'application/pdf',
      name: 'rfp.pdf',
    });
    expect(text.replace(/\s+/g, ' ')).toContain('the vendor shall provide a pricing workbook');
  }, 30_000);

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
