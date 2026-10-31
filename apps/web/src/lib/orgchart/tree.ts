// Pure tree operations on the flat node list (parentId links).
import type { OrgNode } from './types';

export const personKey = (n: { contactId: string | null; name: string }) =>
  n.contactId ? `c:${n.contactId}` : `n:${n.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;

export function childrenOf(nodes: OrgNode[]): Map<string | null, OrgNode[]> {
  const m = new Map<string | null, OrgNode[]>();
  for (const n of nodes) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n]);
  return m;
}

export function descendants(nodes: OrgNode[], id: string): Set<string> {
  const kids = childrenOf(nodes);
  const out = new Set<string>();
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n.id)) continue;
    out.add(n.id);
    stack.push(...(kids.get(n.id) ?? []));
  }
  return out;
}

/** Nodes hidden because an ancestor is collapsed. */
export function hiddenBy(nodes: OrgNode[], collapsed: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const id of collapsed) for (const d of descendants(nodes, id)) out.add(d);
  return out;
}

export function ancestors(nodes: OrgNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  while (cur && !out.includes(cur)) { out.push(cur); cur = byId.get(cur)?.parentId ?? null; }
  return out;
}

export function canReparent(nodes: OrgNode[], id: string, newParent: string | null): boolean {
  if (newParent === id) return false;
  if (newParent === null) return true;
  return !descendants(nodes, id).has(newParent);
}

export function reparent(nodes: OrgNode[], id: string, newParent: string | null): OrgNode[] {
  if (!canReparent(nodes, id, newParent)) return nodes;
  return nodes.map((n) => (n.id === id ? { ...n, parentId: newParent } : n));
}

export function update(nodes: OrgNode[], id: string, patch: Partial<Omit<OrgNode, 'id'>>): OrgNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
}

/** Remove one person; their reports move up to the removed person's manager. */
export function remove(nodes: OrgNode[], rootId: string | null, id: string): { nodes: OrgNode[]; rootId: string | null } {
  const gone = nodes.find((n) => n.id === id);
  if (!gone) return { nodes, rootId };
  let rest = nodes.filter((n) => n.id !== id);
  if (id !== rootId) return { nodes: rest.map((n) => (n.parentId === id ? { ...n, parentId: gone.parentId } : n)), rootId };
  const heirs = rest.filter((n) => n.parentId === id);
  const heir = heirs[0];
  if (!heir) return { nodes: rest, rootId: rest[0]?.id ?? null };
  rest = rest.map((n) => (n.id === heir.id ? { ...n, parentId: null } : n.parentId === id ? { ...n, parentId: heir.id } : n));
  return { nodes: rest, rootId: heir.id };
}

/** Make `id` the top of the chart; the path above it flips so nobody is lost. */
export function setRoot(nodes: OrgNode[], id: string): { nodes: OrgNode[]; rootId: string } {
  const path = [id, ...ancestors(nodes, id)];
  const flip = new Map<string, string | null>();
  flip.set(id, null);
  for (let i = 1; i < path.length; i++) flip.set(path[i]!, path[i - 1]!);
  return { nodes: nodes.map((n) => (flip.has(n.id) ? { ...n, parentId: flip.get(n.id)! } : n)), rootId: id };
}

let seq = 0;
export const newId = () => `n-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function addReport(nodes: OrgNode[], parentId: string | null, init: Partial<OrgNode> = {}): { nodes: OrgNode[]; id: string } {
  const id = newId();
  const node: OrgNode = {
    id, parentId, name: 'New person', title: null, photoUrl: null, seniority: 'unknown', region: null,
    contactId: null, email: null, ownerName: null, source: 'manual', ...init,
  };
  return { nodes: [...nodes, node], id };
}

/** Orphans (parent missing) hang off the root so the chart stays one tree. */
export function normalise(nodes: OrgNode[], rootId: string | null): { nodes: OrgNode[]; rootId: string | null } {
  const ids = new Set(nodes.map((n) => n.id));
  const root = rootId && ids.has(rootId) ? rootId : (nodes.find((n) => n.parentId === null)?.id ?? nodes[0]?.id ?? null);
  return {
    rootId: root,
    nodes: nodes.map((n) => {
      if (n.id === root) return n.parentId === null ? n : { ...n, parentId: null };
      if (n.parentId && ids.has(n.parentId)) return n;
      return { ...n, parentId: root };
    }),
  };
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
