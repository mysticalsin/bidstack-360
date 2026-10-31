// CSV export of the chart in the org chart API's import columns, so an
// exported file round-trips through Import CSV (parsing and validation of
// imports happen server-side: all or nothing, with a dry-run preview).
import type { OrgNode } from './types';

const esc = (v: string | null) => (v == null ? '' : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
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
