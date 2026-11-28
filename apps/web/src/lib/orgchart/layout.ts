// Top-down tree layout (dagre, MIT). Returns top-left positions.
// NODE_W / NODE_H are the card box. The person node fills that box so
// reporting lines meet the card edge, not a gap around a smaller pill.
import dagre from '@dagrejs/dagre';

import type { OrgNode } from './types';

export const NODE_W = 268;
export const NODE_H = 176;

/**
 * Orthogonal elbows, not bezier curves. A reporting line should look like
 * an org chart: one vertical drop, a horizontal bus, a drop into the card.
 */
export const ORG_EDGE = {
  type: 'smoothstep' as const,
  pathOptions: { borderRadius: 14, offset: 18 },
};

export function layoutTree(nodes: OrgNode[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  // nodesep/ranksep are gaps between cards, so a wide level can scroll
  // instead of colliding, and the collapse control has room under the card.
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 76, marginx: 24, marginy: 24 });
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
