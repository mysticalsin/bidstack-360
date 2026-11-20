import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { pumpBatches } from './batch-stream.js';

type Row = { id: string };

function source(total: number, batchSize: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: String(i).padStart(6, '0') }));
  const calls: Array<string | undefined> = [];
  const nextBatch = async (cursor: string | undefined): Promise<Row[]> => {
    calls.push(cursor);
    const start = cursor === undefined ? 0 : rows.findIndex((r) => r.id === cursor) + 1;
    return rows.slice(start, start + batchSize);
  };
  return { nextBatch, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('pumpBatches', () => {
  it('writes every row and ends the stream', async () => {
    const out = new PassThrough();
    const chunks: string[] = [];
    out.on('data', (c: Buffer) => chunks.push(c.toString()));
    const { nextBatch } = source(7, 3);
    const result = await pumpBatches<Row>({
      out,
      header: 'id\n',
      batchSize: 3,
      nextBatch,
      cursorOf: (r) => r.id,
      toLine: (r) => `${r.id}\n`,
    });
    expect(result).toEqual({ written: 7, aborted: false });
    expect(chunks.join('').trim().split('\n')).toHaveLength(8);
    expect(out.writableEnded).toBe(true);
  });

  it('waits for the reader before fetching the next batch (backpressure)', async () => {
    const out = new PassThrough({ highWaterMark: 8 });
    const { nextBatch, calls } = source(30, 5);
    const done = pumpBatches<Row>({
      out,
      batchSize: 5,
      nextBatch,
      cursorOf: (r) => r.id,
      toLine: (r) => `${r.id}\n`,
    });
    await tick();
    expect(calls.length).toBe(1);
    out.resume();
    await done;
    expect(calls.length).toBeGreaterThan(1);
  });

  it('stops paging once the client goes away', async () => {
    const out = new PassThrough({ highWaterMark: 8 });
    const { nextBatch, calls } = source(10_000, 5);
    const done = pumpBatches<Row>({
      out,
      batchSize: 5,
      nextBatch,
      cursorOf: (r) => r.id,
      toLine: (r) => `${r.id}\n`,
    });
    await tick();
    out.destroy();
    const result = await done;
    expect(result.aborted).toBe(true);
    expect(calls.length).toBeLessThan(3);
  });
});
