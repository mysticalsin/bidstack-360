// Sandbox wrapper for extractTextFromBuffer.
//
// Why this exists: the parsers we rely on (pdf-parse@2.4.5, mammoth,
// node-pptx-parser, and a custom OLE PowerPoint string scrape) all run
// untrusted, attacker-controlled bytes through native or third-party code.
// pdf-parse in particular has a CVE history (DoS via crafted streams,
// OOM via decompression bombs). The 2026-05-24 audit rated this HIGH-2.
//
// Mitigation: run the parser inside a `worker_threads.Worker` with
//   - `resourceLimits.maxOldGenerationSizeMb: 256` — bounds heap so a
//     decompression bomb cannot exhaust the parent process memory.
//   - A 90-second hard timeout via `worker.terminate()` — bounds CPU so
//     a pathological input cannot pin the event loop forever.
//   - Structured `{ok, text, error}` message passing — every parser
//     exception is surfaced to the caller as a normal rejection rather
//     than an uncaught exception that would crash the worker process.
//
// Replacing pdf-parse with `unpdf` or `pdf2json` is tracked separately
// and is out of scope here; this PR contains the blast-radius reduction.

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { ExtractOptions } from './extract-text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Hard wall-clock cap for any single extraction. The worker is `terminate()`'d
 *  if it doesn't post a result within this window — protects against parsers
 *  that go into infinite loops on crafted input. */
export const EXTRACT_TIMEOUT_MS = 90_000;

/** Maximum heap size for the parser worker. PDFs with deeply nested streams
 *  can balloon mammoth/pdf-parse memory well past the input size; this caps
 *  the damage. The parent stays at its normal --max-old-space-size. */
export const EXTRACT_MAX_HEAP_MB = 256;

type SandboxMessage = { ok: true; text: string } | { ok: false; error: string; stack?: string };

interface SandboxOptions {
  timeoutMs?: number;
  maxOldGenerationSizeMb?: number;
}

/** Resolve the path to the worker entry script.
 *
 * Production / built output: `extract-text-worker.js` sits next to this file
 * in dist/, so the .js path works directly.
 *
 * Dev / tests (tsx, vitest): the .js sibling doesn't exist on disk and the
 * runtime is loading us from .ts. We detect that by checking the suffix of
 * `import.meta.url` and load .ts via `tsx` as the worker `execArgv`. This
 * keeps the worker_thread sandbox testable without a build step. */
function resolveWorkerEntry(): { entry: string; execArgv?: string[] } {
  // import.meta.url ends in .ts during dev (tsx, vitest) and .js in prod.
  const meUrl = import.meta.url;
  if (meUrl.endsWith('.ts')) {
    return {
      entry: path.join(__dirname, 'extract-text-worker.ts'),
      execArgv: ['--import', 'tsx'],
    };
  }
  return { entry: path.join(__dirname, 'extract-text-worker.js') };
}

export async function extractTextFromBufferSandboxed(
  opts: ExtractOptions,
  sandboxOpts: SandboxOptions = {},
): Promise<string> {
  const timeoutMs = sandboxOpts.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const maxHeapMb = sandboxOpts.maxOldGenerationSizeMb ?? EXTRACT_MAX_HEAP_MB;

  // Buffers cannot cross worker_thread boundaries inline without a postMessage
  // copy. We transfer the underlying ArrayBuffer for zero-copy efficiency by
  // listing it in the `transferList`. The original Buffer becomes unusable in
  // the parent after transfer, but we don't need it again. Cast away the
  // `ArrayBufferLike` union — Node's Buffer.buffer can be a SharedArrayBuffer
  // in theory but in practice it's always ArrayBuffer for buffers we control.
  const ab = opts.buffer.buffer.slice(
    opts.buffer.byteOffset,
    opts.buffer.byteOffset + opts.buffer.byteLength,
  ) as ArrayBuffer;

  const { entry, execArgv } = resolveWorkerEntry();

  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: {
        bufferData: ab,
        contentType: opts.contentType,
        name: opts.name,
        sourcePath: opts.sourcePath,
      },
      transferList: [ab],
      resourceLimits: {
        maxOldGenerationSizeMb: maxHeapMb,
      },
      ...(execArgv ? { execArgv } : {}),
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(
        new Error(
          `Document extraction exceeded the ${timeoutMs}ms sandbox timeout. ` +
            `The parser was terminated to protect the worker process.`,
        ),
      );
    }, timeoutMs);

    worker.once('message', (msg: SandboxMessage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (msg.ok) {
        resolve(msg.text);
      } else {
        reject(new Error(`Document extraction failed in sandbox: ${msg.error}`));
      }
    });

    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      reject(
        new Error(
          `Document extraction worker crashed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    });

    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Non-zero exit without a prior message means the worker died before
      // posting back — usually OOM (ERR_WORKER_OUT_OF_MEMORY) or hard SIGKILL
      // from the resource limit. Treat as a sandbox-caught failure so the
      // caller can mark the extraction as errored without bringing the
      // queue worker down with it.
      reject(
        new Error(
          `Document extraction worker exited with code ${code} before returning a result. ` +
            `Likely cause: input exceeded the ${maxHeapMb}MB heap cap.`,
        ),
      );
    });
  });
}
