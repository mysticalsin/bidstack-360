import { deflateRawSync } from 'node:zlib';

import * as XLSX from '@e965/xlsx';
import { describe, expect, it } from 'vitest';

import { SpreadsheetRejected, parseSpreadsheetBuffer } from './migrations.js';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** One deflated entry whose header claims `uncompressed` bytes. */
function zipWithClaim(name: string, payload: Buffer, uncompressed: number): Buffer {
  const compressed = deflateRawSync(payload, { level: 9 });
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(payload), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(uncompressed, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([local, nameBuf, compressed]);
}

describe('parseSpreadsheetBuffer', () => {
  it('reads a real workbook', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Name'], ['Acme']]), 'Sheet1');
    const buf = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const parsed = parseSpreadsheetBuffer(buf, 'accounts.xlsx');
    expect(parsed.truncated).toBe(false);
    expect(parsed.rows).toEqual([{ Name: 'Acme' }]);
  });

  it('rejects bytes that are not a workbook instead of an empty sheet', () => {
    expect(() => parseSpreadsheetBuffer(Buffer.from('this is not a workbook'), 'bad.xlsx')).toThrow(
      SpreadsheetRejected,
    );
  });

  it('rejects a zip whose declared size exceeds 8 MB before parsing it', () => {
    const bomb = zipWithClaim('xl/worksheets/sheet1.xml', Buffer.from('A'), 9 * 1024 * 1024);
    expect(() => parseSpreadsheetBuffer(bomb, 'bomb.xlsx')).toThrow(SpreadsheetRejected);
  });

  it('tells the caller when a CSV was longer than the 10k cap', () => {
    const lines = ['Name'];
    for (let i = 0; i < 10_001; i++) lines.push('N' + i);
    const parsed = parseSpreadsheetBuffer(Buffer.from(lines.join('\n')), 'big.csv');
    expect(parsed.rows).toHaveLength(10_000);
    expect(parsed.truncated).toBe(true);
  });
});
