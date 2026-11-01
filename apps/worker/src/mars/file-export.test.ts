// SharePoint/OneDrive export fallback (mock store only): CSV and XLSX
// parsing with the column map, strict account filter, snapshot cursor.
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { DEFAULT_MARS_COLUMN_MAP, MarsEntry } from '@bidstack/shared';

import { encodeFileCursor, fileExportMarsSource, mockExportStore, parseExportFile } from './file-export.js';
import { parsePeople, toDate } from './tabular.js';

const require = createRequire(import.meta.url);
const xlsx = require('@e965/xlsx') as {
  utils: { book_new(): unknown; json_to_sheet(rows: unknown[]): unknown; book_append_sheet(wb: unknown, ws: unknown, name: string): void };
  write(wb: unknown, opts: { type: 'buffer'; bookType: 'xlsx' }): Buffer;
};

const CSV = [
  '\uFEFFAccount,Contact Name,Contact Email,Contact Title,Company,Meeting Date,Internal Attendee,Notes',
  'Northwind Energy,Jane Doe,jane@northwind-energy.example,CFO,Northwind Energy plc,2026-10-20,kam.uk@polo.example,"Budget, timing"',
  'Northwind Energy,Raj Patel,not-an-email,CIO,Northwind Energy plc,2026-10-20,kam.uk@polo.example,',
  'Northwind Energy Services,Not Ours,x@nes.example,CEO,NES,2026-10-21,kam.uk@polo.example,',
  'Contoso,Other,o@contoso.example,VP,Contoso,2026-10-22,kam.uk@polo.example,',
  ',No Account,,,,2026-10-22,,',
].join('\n');

describe('tabular helpers', () => {
  it('parses people lists without splitting "Last, First"', () => {
    expect(parsePeople('Alex Turner <Kam.UK@polo.example>; sam@polo.example | Lee, Sam')).toEqual([
      { name: 'Alex Turner', email: 'kam.uk@polo.example' },
      { name: 'sam', email: 'sam@polo.example' },
      { name: 'Lee, Sam', email: null },
    ]);
  });
  it('reads zone-less, date-only and Excel serial dates as UTC', () => {
    expect(toDate('2026-10-20T09:30:00')?.toISOString()).toBe('2026-10-20T09:30:00.000Z');
    expect(toDate('2026-10-20')?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(toDate(46315)?.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect(toDate('soon')).toBeNull();
  });
});

describe('fileExportMarsSource', () => {
  it('maps CSV headers through the column map and keeps only mapped accounts', async () => {
    const rows = parseExportFile('mars.csv', Buffer.from(CSV), DEFAULT_MARS_COLUMN_MAP);
    expect(rows[0]).toMatchObject({ account: 'Northwind Energy', contactName: 'Jane Doe', notes: 'Budget, timing' });

    const store = mockExportStore([{ name: 'mars-2026-10-30.csv', modifiedAt: new Date('2026-10-30T06:00:00Z'), content: CSV }]);
    const src = fileExportMarsSource(store, DEFAULT_MARS_COLUMN_MAP);
    expect(src.kind).toBe('file_export');
    const p = await src.listEntries({ cursor: null, updatedSince: null, limit: 100, accountKeys: ['northwind energy'] });
    const items = p.items.map((i) => MarsEntry.parse(i));
    expect(items).toHaveLength(1);
    expect(items[0]!.contacts.map((c) => [c.fullName, c.email])).toEqual([['Jane Doe', 'jane@northwind-energy.example'], ['Raj Patel', null]]);
    expect(items[0]!.loggedBy.email).toBe('kam.uk@polo.example');
    expect(JSON.stringify(items)).not.toMatch(/Not Ours|Contoso/);
    expect(p.nextCursor).toBe(encodeFileCursor({ name: 'mars-2026-10-30.csv', modifiedAt: new Date('2026-10-30T06:00:00Z') }));
  });

  it('reads XLSX the same way, preferring the sheet named like the table', async () => {
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([{ Account: 'Decoy', 'Contact Name': 'X', 'Meeting Date': '2026-10-01' }]), 'Cover');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([
      { Account: 'NWE-UK', 'Contact Name': 'Mo Khan', 'Contact Title': 'COO', 'Meeting Date': new Date('2026-10-27T10:00:00Z'), 'Internal Attendee': 'Alex Turner <kam.uk@polo.example>' },
    ]), 'MARS Meetings');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const store = mockExportStore([{ name: 'export.xlsx', modifiedAt: new Date('2026-10-30T06:00:00Z'), content: buf }]);
    const p = await fileExportMarsSource(store, DEFAULT_MARS_COLUMN_MAP).listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: ['NWE-UK'] });
    const e = MarsEntry.parse(p.items[0]);
    expect(e.contacts[0]).toMatchObject({ fullName: 'Mo Khan', jobTitle: 'COO' });
    expect(e.meetingDate.slice(0, 10)).toBe('2026-10-27');
  });

  it('reads only the newest snapshot after the cursor, and nothing until accounts are mapped', async () => {
    const store = mockExportStore([
      { name: 'a.csv', modifiedAt: new Date('2026-10-28T06:00:00Z'), content: CSV },
      { name: 'b.csv', modifiedAt: new Date('2026-10-30T06:00:00Z'), content: CSV },
      { name: 'notes.txt', modifiedAt: new Date('2026-10-31T06:00:00Z'), content: 'x' },
    ]);
    const src = fileExportMarsSource(store, DEFAULT_MARS_COLUMN_MAP);
    expect(await src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: [] })).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(store.downloads).toEqual([]);
    const p = await src.listEntries({ cursor: null, updatedSince: null, limit: 10, accountKeys: ['Northwind Energy'] });
    expect(store.downloads).toEqual(['f2']);
    const again = await src.listEntries({ cursor: p.nextCursor, updatedSince: null, limit: 10, accountKeys: ['Northwind Energy'] });
    expect(again.items).toEqual([]);
    expect(store.downloads).toEqual(['f2']);
  });
});
