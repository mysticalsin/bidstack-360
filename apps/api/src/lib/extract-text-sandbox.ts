// Sandbox wrapper for extractTextFromBuffer — see the long comment in
// apps/worker/src/lib/extract-text-sandbox.ts for the threat model and
// design. The two copies exist because the api and worker workspaces are
// independently built (no shared package for these libs yet); the
// behaviour MUST stay in lockstep — keep them aligned when editing.

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { ExtractOptions } from './extract-text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EXTRACT_TIMEOUT_MS = 90_000;
export const EXTRACT_MAX_HEAP_MB = 256;

type SandboxMessage = { ok: true; text: string } | { ok: false; error: string; stack?: string };

interface SandboxOptions {
  timeoutMs?: number;
  maxOldGenerationSizeMb?: number;
}

function resolveWorkerEntry(): { entry: string; execArgv?: string[] } {
  // import.meta.url ends in .ts during dev (tsx, vitest) and .js in prod.
  // See apps/worker/src/lib/extract-text-sandbox.ts for the full rationale.
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
            `The parser was terminated to protect the API process.`,
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
      reject(
        new Error(
          `Document extraction worker exited with code ${code} before returning a result. ` +
            `Likely cause: input exceeded the ${maxHeapMb}MB heap cap.`,
        ),
      );
    });
  });
}
