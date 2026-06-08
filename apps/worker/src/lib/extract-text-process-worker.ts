// Process entry for PDF extraction.
//
// pdf-parse@2.x can destabilize Node on Windows when it runs inside a
// worker_threads.Worker, even after the parser is destroyed. PDFs therefore use
// a process boundary while the normal sandbox keeps worker_threads for lighter
// formats. The parent sends one JSON payload on stdin and receives one JSON
// payload on stdout.

import { stdin, stdout } from 'node:process';

import { extractTextFromBuffer } from './extract-text.js';

interface ProcessInput {
  bufferBase64: string;
  contentType: string;
  name?: string;
  sourcePath?: string;
}

type ProcessMessage = { ok: true; text: string } | { ok: false; error: string; stack?: string };

async function readStdin(): Promise<string> {
  stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stdin) raw += chunk;
  return raw;
}

async function main(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as ProcessInput;
    const text = await extractTextFromBuffer({
      buffer: Buffer.from(input.bufferBase64, 'base64'),
      contentType: input.contentType,
      name: input.name,
      sourcePath: input.sourcePath,
    });
    const msg: ProcessMessage = { ok: true, text };
    stdout.write(JSON.stringify(msg));
  } catch (err) {
    const msg: ProcessMessage = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    stdout.write(JSON.stringify(msg));
  }
}

void main();
