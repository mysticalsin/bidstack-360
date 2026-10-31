// One person on the org chart: avatar (ring coloured by meeting recency, with
// a "Met recently" badge), name pill, title, seniority and region chips,
// relationship meter, contact links (email, LinkedIn, phone) and a collapse toggle.
import { SENIORITY_LABEL } from '@/lib/meeting-intel/client';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { STRENGTH_BARS, STRENGTH_LABEL } from '@/lib/orgchart/coverage';
import { recencyBadge, recencyOf, recencyTitle } from '@/lib/orgchart/recency';
import type { NodeCov, OrgNode, Strength } from '@/lib/orgchart/types';

import { ContactLinks } from './ContactLinks';
import { OrgPhoto } from './OrgPhoto';

export interface PersonData extends Record<string, unknown> {
  node: OrgNode;
  cov: NodeCov | undefined;
  /** Director-and-above never met (API coverage); highlighted as a gap. */
  seniorGap?: boolean;
  strength: Strength;
  showMet: boolean;
  showStrength: boolean;
  match: 'none' | 'hit' | 'miss';
  childCount: number;
  collapsed: boolean;
  isRoot: boolean;
  /** Reference "now" for meeting recency (keeps render pure). */
  asOf?: number;
  onToggle: (id: string) => void;
}
export type PersonNodeT = Node<PersonData, 'person'>;


const SHORT_SEN: Record<string, string> = { c_level: 'C-level', vp: 'VP', director: 'Director', manager: 'Manager', ic: 'IC', unknown: '' };

function PersonNodeImpl({ id, data, selected }: NodeProps<PersonNodeT>) {
  const { node, cov, strength, showMet, showStrength, match, childCount, collapsed, onToggle, seniorGap } = data;
  const met = Boolean(cov?.met);
  const now = data.asOf ?? 0;
  const lastMetAt = cov?.lastMetAt ?? null;
  const recency = met ? recencyOf(lastMetAt, now) : 'never';
  const badge = showMet && met ? recencyBadge(lastMetAt, now) : null;
  const ring = !showMet ? undefined : recency === 'recent' ? 'met' : recency === 'warm' ? 'warm' : met ? 'stale' : 'gap';
  const sen = SHORT_SEN[node.seniority];
  const label = [
    node.name, node.title, sen && SENIORITY_LABEL[node.seniority], node.region,
    met ? `met ${cov!.count} time${cov!.count === 1 ? '' : 's'}${lastMetAt ? `, ${recencyTitle(lastMetAt).toLowerCase()}` : ''}` : seniorGap ? 'senior gap, not met yet' : 'not met yet',
    node.redacted ? 'restricted' : '',
    `relationship ${STRENGTH_LABEL[strength].toLowerCase()}`,
    childCount ? `${childCount} direct report${childCount === 1 ? '' : 's'}${collapsed ? ', collapsed' : ''}` : '',
  ].filter(Boolean).join(', ');
  return (
    <div
      className="oc-node"
      data-met={met}
      data-recency={recency}
      data-dim={(showMet && !met) || match === 'miss' ? 'true' : undefined}
      data-hit={match === 'hit' || undefined}
      data-selected={selected || undefined}
      data-sample={node.source === 'sample' || undefined}
      data-gap={(showMet && seniorGap) || undefined}
      data-redacted={node.redacted || undefined}
      data-testid="orgchart-node"
      data-name={node.name}
      aria-label={label}
    >
      <Handle type="target" position={Position.Top} className="oc-handle" isConnectable={false} />
      <div className="oc-ava" data-ring={ring} aria-hidden="true" title={showMet ? recencyTitle(lastMetAt) : undefined}>
        <OrgPhoto url={node.photoUrl} name={node.name} />
        {showMet && met && recency !== 'stale' ? <i className="oc-met-dot" data-r={recency} aria-hidden="true" /> : null}
      </div>
      {badge ? (
        <span className="oc-recency" data-r={recency} title={recencyTitle(lastMetAt)} data-testid="orgchart-recency">{badge}</span>
      ) : null}
      <div className="oc-pill">
        <span className="oc-name">{node.name}</span>
      </div>
      <span className="oc-title">{node.redacted ? 'Outside your access' : node.title ?? 'No title'}</span>
      <span className="oc-chips">
        {sen ? <span className="oc-chip" data-sen={node.seniority}>{sen}</span> : null}
        {node.region ? <span className="oc-chip">{node.region}</span> : null}
        {showStrength ? (
          <span className="oc-meter" data-s={strength} title={`Relationship: ${STRENGTH_LABEL[strength]}`}>
            {[1, 2, 3].map((i) => <i key={i} data-on={i <= STRENGTH_BARS[strength] || undefined} />)}
          </span>
        ) : null}
      </span>
      {!node.redacted ? <ContactLinks node={node} compact /> : null}
      {childCount ? (
        <button
          type="button"
          className="oc-collapse nodrag"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${childCount} report${childCount === 1 ? '' : 's'} of ${node.name}`}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onToggle(id); }}
        >
          {collapsed ? `+${childCount}` : '−'}
        </button>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="oc-handle" isConnectable={false} />
    </div>
  );
}

export const PersonNode = memo(PersonNodeImpl);
