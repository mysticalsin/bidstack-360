// CSV import/export. Columns: name, title, seniority, region, manager, email.
// `manager` is the manager's name (or id from an export). One row per person.
import { SeniorityLevel } from '@bidstack/shared';

import { newId } from './tree';
import type { OrgNode } from './types';

export const CSV_COLUMNS = ['id', 'name', 'title', 'seniority', 'region', 'manager', 'email', 'owner'] as const;

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const SEN_ALIASES: Record<string, SeniorityLevel> = {
  'c-level': 'c_level', clevel: 'c_level', c_level: 'c_level', exec: 'c_level', vp: 'vp', director: 'director',
  manager: 'manager', ic: 'ic', individual: 'ic', unknown: 'unknown', '': 'unknown',
};

export interface CsvImport { nodes: OrgNode[]; rootId: string | null; errors: string[] }

export function importCsv(text: string): CsvImport {
  const rows = parseRows(text.replace(/^\uFEFF/, ''));
  const errors: string[] = [];
  if (!rows.length) return { nodes: [], rootId: null, errors: ['The file is empty.'] };
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (k: string) => head.indexOf(k);
  if (col('name') < 0) return { nodes: [], rootId: null, errors: ['Missing a "name" column.'] };
  const get = (r: string[], k: string) => (col(k) >= 0 ? (r[col(k)] ?? '').trim() : '');
  const draft = rows.slice(1).map((r, i) => {
    const sRaw = get(r, 'seniority').toLowerCase();
    const sen = SEN_ALIASES[sRaw] ?? (SeniorityLevel.safeParse(sRaw).success ? (sRaw as SeniorityLevel) : 'unknown');
    if (!get(r, 'name')) errors.push(`Row ${i + 2}: no name, skipped.`);
    return { ext: get(r, 'id'), manager: get(r, 'manager'), node: {
      id: newId(), parentId: null, name: get(r, 'name'), title: get(r, 'title') || null, photoUrl: null, seniority: sen,
      region: get(r, 'region') || null, contactId: null, email: get(r, 'email') || null, ownerName: get(r, 'owner') || null, source: 'csv',
    } as OrgNode };
  }).filter((d) => d.node.name);
  const byExt = new Map(draft.filter((d) => d.ext).map((d) => [d.ext, d.node.id]));
  const byName = new Map(draft.map((d) => [d.node.name.toLowerCase(), d.node.id]));
  for (const d of draft) {
    if (!d.manager) continue;
    const pid = byExt.get(d.manager) ?? byName.get(d.manager.toLowerCase());
    if (pid && pid !== d.node.id) d.node.parentId = pid;
    else errors.push(`${d.node.name}: manager "${d.manager}" not found, placed at the top.`);
  }
  const roots = draft.filter((d) => !d.node.parentId);
  if (roots.length > 1) errors.push(`${roots.length} people have no manager; ${roots[0]!.node.name} is the root and the others report to them.`);
  const rootId = roots[0]?.node.id ?? draft[0]?.node.id ?? null;
  const nodes = draft.map((d) => (d.node.id !== rootId && !d.node.parentId ? { ...d.node, parentId: rootId } : d.node));
  return { nodes, rootId, errors };
}

const esc = (v: string | null) => (v == null ? '' : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function exportCsv(nodes: OrgNode[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const n of nodes) lines.push([n.id, n.name, n.title, n.seniority, n.region, n.parentId, n.email, n.ownerName].map(esc).join(','));
  return `${lines.join('\n')}\n`;
}
