import type { Writable } from 'node:stream';

/** Options for {@link pumpBatches}. */
export interface PumpBatchesOptions<T> {
  out: Writable;
  /** Written once before the first batch. */
  header?: string;
  batchSize: number;
  /** Fetch the batch after `cursor` (undefined for the first batch). */
  nextBatch: (cursor: string | undefined) => Promise<T[]>;
  cursorOf: (row: T) => string;
  toLine: (row: T) => string;
}

function closed(out: Writable): boolean {
  return out.destroyed || out.writableEnded;
}

/** Resolve on 'drain', or as soon as the stream closes or errors. */
function drained(out: Writable): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      out.off('drain', done);
      out.off('close', done);
      out.off('error', done);
      resolve();
    };
    out.on('drain', done);
    out.on('close', done);
    out.on('error', done);
  });
}

/**
 * Page rows into a writable stream one batch at a time. Waits for the reader
 * before fetching the next batch (backpressure), and stops paging as soon as
 * the stream is closed, so a client that disconnects mid-export does not
 * leave the server reading every remaining batch from the database.
 */
export async function pumpBatches<T>(
  opts: PumpBatchesOptions<T>,
): Promise<{ written: number; aborted: boolean }> {
  const { out } = opts;
  let written = 0;
  let cursor: string | undefined;

  const write = async (chunk: string): Promise<boolean> => {
    if (closed(out)) return false;
    if (!out.write(chunk)) await drained(out);
    return !closed(out);
  };

  if (opts.header !== undefined && !(await write(opts.header))) {
    return { written, aborted: true };
  }
  while (true) {
    if (closed(out)) return { written, aborted: true };
    const batch = await opts.nextBatch(cursor);
    if (batch.length === 0) break;
    if (!(await write(batch.map(opts.toLine).join('')))) return { written, aborted: true };
    written += batch.length;
    cursor = opts.cursorOf(batch[batch.length - 1]!);
    if (batch.length < opts.batchSize) break;
  }
  if (closed(out)) return { written, aborted: true };
  out.end();
  return { written, aborted: false };
}
