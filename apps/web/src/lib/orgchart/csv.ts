// CSV export of the chart in the org chart API's import columns, so an
// exported file round-trips through Import CSV (parsing and validation of
// imports happen server-side: all or nothing, with a dry-run preview).
import { csvCell } from '../csv';
import type { OrgNode } from './types';

// csvCell prefixes = + - @ tab CR so a name or title cannot become a formula
// when the file is opened in a spreadsheet. Quoting still covers commas.
const esc = (v: string | null) => {
  if (v == null) return '';
  const safe = csvCell(v);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** Export in the API import columns, so the file round-trips through Import CSV. */
export function exportCsv(nodes: OrgNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cols = ['name', 'title', 'email', 'manager_name', 'seniority', 'function', 'region', 'photo_url', 'relationship_strength'];
  const lines = [cols.join(',')];
  for (const n of nodes) {
    if (n.redacted) continue;
    const photo = n.photoUrl?.startsWith('https://') ? n.photoUrl : null;
    lines.push([n.name, n.title, n.email, n.parentId ? byId.get(n.parentId)?.name ?? null : null, n.seniority, n.function ?? null, n.region, photo, n.relationshipStrength ? String(n.relationshipStrength) : null].map(esc).join(','));
  }
  return `${lines.join('\n')}\n`;
}
