/**
 * Fallback MARS source: a scheduled CSV or XLSX export of the MARS Power BI
 * report, dropped in a SharePoint or OneDrive folder (Power BI subscription
 * or Power Automate "export data", for example).
 *
 * MOCK ONLY for now: the folder is reached through the small MarsExportStore
 * interface and only an in-memory store exists. A Microsoft Graph store
 * (GET /drives/{driveId}/items/{folderId}/children, then /content, app
 * permission Sites.Selected on that one site) slots in behind the same
 * interface without touching parsing or sync.
 *
 * Same column map and strict account filter as the Power BI source. Exports
 * are treated as full snapshots by default: only the newest file newer than
 * the cursor is read. Re-reading an unchanged entry is a no-op (content
 * hashed version), so overlapping snapshots are safe.
 */
import { createRequire } from 'node:module';

import { type MarsColumnMap, type MarsTabularField, normalizeMarsAccountKey } from '@bidstack/shared';

import type { MarsClient, MarsPage } from './client.js';
import { mappedFields } from './powerbi.js';
import { type MarsTabularRow, rowsToEntries } from './tabular.js';

const require = createRequire(import.meta.url);

export interface MarsExportFile {
  id: string;
  name: string;
  modifiedAt: Date;
  size: number;
}

export interface MarsExportStore {
  listFiles(): Promise<MarsExportFile[]>;
  download(id: string): Promise<Buffer>;
}

/** In-memory folder for tests and local runs. */
export function mockExportStore(files: Array<{ name: string; modifiedAt: Date; content: Buffer | string }>): MarsExportStore & { downloads: string[] } {
  const items = files.map((f, i) => ({ id: `f${i + 1}`, name: f.name, modifiedAt: f.modifiedAt, buf: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8') }));
  const downloads: string[] = [];
  return {
    downloads,
    async listFiles() {
      return items.map(({ id, name, modifiedAt, buf }) => ({ id, name, modifiedAt, size: buf.length }));
    },
    async download(id) {
      downloads.push(id);
      const f = items.find((x) => x.id === id);
      if (!f) throw new Error('export file not found');
      return f.buf;
    },
  };
}

interface XlsxModule {
  read(data: Buffer | string, opts: { type: 'buffer' | 'string'; cellDates?: boolean; raw?: boolean }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown, opts: { defval: unknown; raw: boolean }): Record<string, unknown>[] };
}

/** CSV or XLSX to logical rows. Headers match the column map exactly, ignoring case and outer spaces. */
export function parseExportFile(name: string, buf: Buffer, map: MarsColumnMap): MarsTabularRow[] {
  const xlsx = require('@e965/xlsx') as XlsxModule;
  const isCsv = /\.csv$/i.test(name);
  const wb = isCsv
    ? xlsx.read(buf.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : xlsx.read(buf, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.find((s) => s.trim().toLowerCase() === map.table.trim().toLowerCase()) ?? wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) return [];
  const raw = xlsx.utils.sheet_to_json(sheet, { defval: null, raw: true });
  const byHeader = new Map<string, MarsTabularField>();
  for (const f of mappedFields(map)) byHeader.set(map.columns[f]!.trim().toLowerCase(), f);
  return raw.map((r) => {
    const out: MarsTabularRow = {};
    for (const [h, v] of Object.entries(r)) {
      const f = byHeader.get(h.trim().toLowerCase());
      if (f) out[f] = v;
    }
    return out;
  });
}

export function encodeFileCursor(f: Pick<MarsExportFile, 'modifiedAt' | 'name'>) {
  return `file1:${f.modifiedAt.toISOString()}|${f.name}`.slice(0, 500);
}
function decodeFileCursor(c: string | null): { at: number; name: string } | null {
  const m = /^file1:([^|]+)\|(.*)$/.exec(c ?? '');
  if (!m) return null;
  const at = Date.parse(m[1]!);
  return Number.isNaN(at) ? null : { at, name: m[2]! };
}

export function fileExportMarsSource(
  store: MarsExportStore,
  map: MarsColumnMap,
  opts: { mode?: 'snapshot' | 'incremental'; maxFileBytes?: number; namePattern?: RegExp } = {},
): MarsClient {
  const mode = opts.mode ?? 'snapshot';
  const maxBytes = opts.maxFileBytes ?? 25 * 1024 * 1024;
  const pattern = opts.namePattern ?? /\.(csv|xlsx)$/i;
  const after = (f: MarsExportFile, c: { at: number; name: string } | null) =>
    !c || f.modifiedAt.getTime() > c.at || (f.modifiedAt.getTime() === c.at && f.name > c.name);

  return {
    configured: true,
    kind: 'file_export',
    scope: 'org',
    async listEntries({ cursor, accountKeys }): Promise<MarsPage> {
      const keys = (accountKeys ?? []).filter((k) => normalizeMarsAccountKey(k));
      // Nothing mapped yet: read nothing and keep the cursor, so mapping later still sees this export.
      if (!keys.length) return { items: [], nextCursor: cursor, hasMore: false };
      const c = decodeFileCursor(cursor);
      const files = (await store.listFiles())
        .filter((f) => pattern.test(f.name) && f.size <= maxBytes && after(f, c))
        .sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime() || a.name.localeCompare(b.name));
      if (!files.length) return { items: [], nextCursor: cursor, hasMore: false };
      const file = mode === 'snapshot' ? files[files.length - 1]! : files[0]!;
      const rows = parseExportFile(file.name, await store.download(file.id), map);
      const { entries } = rowsToEntries(rows, { source: 'file', accountKeys: keys });
      return { items: entries, nextCursor: encodeFileCursor(file), hasMore: mode === 'incremental' && files.length > 1 };
    },
  };
}
