// One person on the org chart: avatar (met ring), name pill, title, seniority
// and region chips, relationship meter and a collapse toggle.
import { SENIORITY_LABEL } from '@/lib/meeting-intel/client';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { STRENGTH_BARS, STRENGTH_LABEL } from '@/lib/orgchart/coverage';
import type { NodeCov, OrgNode, Strength } from '@/lib/orgchart/types';

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
  onToggle: (id: string) => void;
}
export type PersonNodeT = Node<PersonData, 'person'>;


const SHORT_SEN: Record<string, string> = { c_level: 'C-level', vp: 'VP', director: 'Director', manager: 'Manager', ic: 'IC', unknown: '' };

function PersonNodeImpl({ id, data, selected }: NodeProps<PersonNodeT>) {
  const { node, cov, strength, showMet, showStrength, match, childCount, collapsed, onToggle, seniorGap } = data;
  const met = Boolean(cov?.met);
  const sen = SHORT_SEN[node.seniority];
  const label = [
    node.name, node.title, sen && SENIORITY_LABEL[node.seniority], node.region,
    met ? `met ${cov!.count} time${cov!.count === 1 ? '' : 's'}` : seniorGap ? 'senior gap, not met yet' : 'not met yet',
    node.redacted ? 'restricted' : '',
    `relationship ${STRENGTH_LABEL[strength].toLowerCase()}`,
    childCount ? `${childCount} direct report${childCount === 1 ? '' : 's'}${collapsed ? ', collapsed' : ''}` : '',
  ].filter(Boolean).join(', ');
  return (
    <div
      className="oc-node"
      data-met={met}
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
      <div className="oc-ava" data-ring={showMet ? (met ? 'met' : 'gap') : undefined} aria-hidden="true">
        <OrgPhoto url={node.photoUrl} name={node.name} />
        {showMet && met ? <i className="oc-met-dot" /> : null}
      </div>
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
