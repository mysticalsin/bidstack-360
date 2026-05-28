// Lead table row with inline-editable status and priority cells.
import { Link } from 'react-router-dom';

import { LeadPriorityBadge, LeadStatusBadge } from '@/components/lead/LeadStatusBadge';
import { SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { InlineEditSelect } from '@/components/opportunity/InlineEdit';
import type { LeadPatch, LeadSummary } from '@bidstack/shared';

// Defined at module level to keep component identity stable and avoid creating
// new arrays on each render.
const LEAD_STATUS_OPTS = [
  { value: 'new' as const, label: 'New' },
  { value: 'contacted' as const, label: 'Contacted' },
  { value: 'qualified' as const, label: 'Qualified' },
  { value: 'nurture' as const, label: 'Nurture' },
  { value: 'disqualified' as const, label: 'Disqualified' },
  { value: 'converted' as const, label: 'Converted' },
];

const LEAD_PRIORITY_OPTS = [
  { value: 'low' as const, label: 'Low' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'high' as const, label: 'High' },
  { value: 'critical' as const, label: 'Critical' },
];

export function LeadRow({
  lead,
  selected,
  query,
  onToggle,
  onPatch,
  onDelete,
}: {
  lead: LeadSummary;
  selected: boolean;
  query: string;
  onToggle: () => void;
  /** A2: called when an inline edit is committed; patch fan is handled by useUpdateLeadById. */
  onPatch: (patch: LeadPatch) => void;
  onDelete: () => void;
}) {
  return (
    <SpotlightTableRow
      query={query}
      searchableText={`${lead.firstName} ${lead.lastName} ${lead.email ?? ''} ${lead.companyName ?? ''} ${lead.status} ${lead.priority} ${lead.source ?? ''} ${lead.ownerName ?? ''}`}
      data-selected={selected}
      className="group"
    >
      <td className="px-4 py-3">
        <label className="table-checkbox-hit">
          <span className="sr-only">
            {selected
              ? `Deselect ${lead.firstName} ${lead.lastName}`
              : `Select ${lead.firstName} ${lead.lastName}`}
          </span>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="cursor-pointer accent-[var(--brand-primary)]"
          />
        </label>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/leads/${lead.id}`}
          className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
        >
          {lead.firstName} {lead.lastName}
        </Link>
        {lead.email && <div className="text-xs text-[var(--fg-tertiary)]">{lead.email}</div>}
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{lead.companyName ?? '—'}</td>
      {/* A2 — status is inline-editable. Read mode shows the styled badge;
          edit mode swaps in a <select> and blur/Enter commits immediately. */}
      <td className="px-4 py-3">
        <InlineEditSelect
          value={lead.status}
          options={LEAD_STATUS_OPTS}
          onSave={(next) => onPatch({ status: next })}
          label={`Edit status for ${lead.firstName} ${lead.lastName}`}
          display={(v) => <LeadStatusBadge status={v as LeadSummary['status']} />}
        />
      </td>
      {/* A2 — priority is inline-editable. */}
      <td className="px-4 py-3">
        <InlineEditSelect
          value={lead.priority}
          options={LEAD_PRIORITY_OPTS}
          onSave={(next) => onPatch({ priority: next })}
          label={`Edit priority for ${lead.firstName} ${lead.lastName}`}
          display={(v) => <LeadPriorityBadge priority={v as LeadSummary['priority']} />}
        />
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs">{lead.score}</span>
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)] capitalize">{lead.source}</td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{lead.ownerName ?? '—'}</td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          aria-label={`Delete ${lead.firstName} ${lead.lastName}`}
        >
          Delete
        </button>
      </td>
    </SpotlightTableRow>
  );
}
