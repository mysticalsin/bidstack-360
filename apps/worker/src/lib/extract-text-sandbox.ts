// Sandbox wrapper for extractTextFromBuffer.
//
// Why this exists: the parsers we rely on (pdf-parse@2.4.5, mammoth,
// node-pptx-parser, and a custom OLE PowerPoint string scrape) all run
// untrusted, attacker-controlled bytes through native or third-party code.
// pdf-parse in particular has a CVE history (DoS via crafted streams,
// OOM via decompression bombs). The 2026-05-24 audit rated this HIGH-2.
//
// Mitigation: run the parser inside a sandbox:
//   - PDFs use a child-process boundary. pdf-parse@2.x can crash Node on
//     Windows when it runs inside worker_threads, so process isolation is the
//     safer boundary for the highest-risk format.
//   - Other formats use a `worker_threads.Worker` with
//   - `resourceLimits.maxOldGenerationSizeMb: 256` — bounds heap so a
//     decompression bomb cannot exhaust the parent process memory.
//   - A 90-second hard timeout via sandbox termination — bounds CPU so a
//     pathological input cannot pin the event loop forever.
//   - Structured `{ok, text, error}` message passing — every parser
//     exception is surfaced to the caller as a normal rejection rather
//     than an uncaught exception that would crash the worker process.
//
// Replacing pdf-parse with `unpdf` or `pdf2json` is tracked separately
// and is out of scope here; this PR contains the blast-radius reduction.

import { spawn } from 'node:child_process';
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

function resolveProcessEntry(): { entry: string; execArgv: string[] } {
  const meUrl = import.meta.url;
  if (meUrl.endsWith('.ts')) {
    return {
      entry: path.join(__dirname, 'extract-text-process-worker.ts'),
      execArgv: ['--import', 'tsx'],
    };
  }
  return { entry: path.join(__dirname, 'extract-text-process-worker.js'), execArgv: [] };
}

function shouldUseProcessSandbox(opts: ExtractOptions): boolean {
  const ct = (opts.contentType.toLowerCase().split(';')[0] ?? '').trim();
  const ext = opts.name ? path.extname(opts.name).toLowerCase() : '';
  return ct === 'application/pdf' || ext === '.pdf';
}

function extractTextFromBufferProcessSandboxed(
  opts: ExtractOptions,
  sandboxOpts: SandboxOptions,
): Promise<string> {
  const timeoutMs = sandboxOpts.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const maxHeapMb = sandboxOpts.maxOldGenerationSizeMb ?? EXTRACT_MAX_HEAP_MB;
  const { entry, execArgv } = resolveProcessEntry();

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${maxHeapMb}`, ...execArgv, entry],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let settled = false;
    let stdout = '';
    let stderr = '';
    const maxOutputBytes = Math.max(opts.buffer.byteLength * 4, 20 * 1024 * 1024);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `Document extraction exceeded the ${timeoutMs}ms process sandbox timeout. ` +
            `The parser was terminated to protect the worker process.`,
        ),
      );
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new Error('Document extraction process exceeded the maximum output size'));
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Document extraction process crashed: ${err.message}`));
    });

    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Document extraction process exited with code ${code}. ` +
              `${stderr.trim() ? `stderr: ${stderr.trim()}` : 'No stderr returned.'}`,
          ),
        );
        return;
      }

      try {
        const msg = JSON.parse(stdout) as SandboxMessage;
        if (msg.ok) {
          resolve(msg.text);
        } else {
          reject(new Error(`Document extraction failed in process sandbox: ${msg.error}`));
        }
      } catch (err) {
        reject(
          new Error(
            `Document extraction process returned invalid output: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      }
    });

    child.stdin.end(
      JSON.stringify({
        bufferBase64: opts.buffer.toString('base64'),
        contentType: opts.contentType,
        name: opts.name,
        sourcePath: opts.sourcePath,
      }),
    );
  });
}

export async function extractTextFromBufferSandboxed(
  opts: ExtractOptions,
  sandboxOpts: SandboxOptions = {},
): Promise<string> {
  if (shouldUseProcessSandbox(opts)) {
    return extractTextFromBufferProcessSandboxed(opts, sandboxOpts);
  }

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
