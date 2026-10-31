// Top-down tree layout (dagre, MIT). Returns top-left positions.
import dagre from '@dagrejs/dagre';

import type { OrgNode } from './types';

export const NODE_W = 184;
export const NODE_H = 140;

export function layoutTree(nodes: OrgNode[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 64, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) g.setEdge(n.parentId, n.id);
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    out.set(n.id, { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 });
  }
  return out;
}
