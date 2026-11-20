// Lead table row with inline-editable status and priority cells.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { LeadPriorityBadge, LeadStatusBadge } from '@/components/lead/LeadStatusBadge';
import { SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { InlineEditSelect } from '@/components/opportunity/InlineEdit';
import type { LeadPatch, LeadSummary } from '@bidstack/shared';

export function LeadRow({
  lead,
  selected,
  query,
  onToggle,
  onPatch,
  onDelete,
  canWrite,
}: {
  lead: LeadSummary;
  selected: boolean;
  query: string;
  onToggle: () => void;
  /** A2: called when an inline edit is committed; patch fan is handled by useUpdateLeadById. */
  onPatch: (patch: LeadPatch) => void;
  onDelete: () => void;
  /** False when the signed-in user lacks leads:write — status/priority render
   * as static badges instead of click-to-edit triggers (the PATCH 403s
   * server-side otherwise), and delete is disabled. */
  canWrite: boolean;
}) {
  const { t } = useTranslation('crm');
  const readOnlyHint = t(
    'leadRow.readOnlyHint',
    'You need lead write access to manage this record.',
  );

  // Localized option labels, memoized to keep array identity stable across renders.
  const leadStatusOpts = useMemo(
    () => [
      { value: 'new' as const, label: t('leadRow.statusNew', 'New') },
      { value: 'contacted' as const, label: t('leadRow.statusContacted', 'Contacted') },
      { value: 'qualified' as const, label: t('leadRow.statusQualified', 'Qualified') },
      { value: 'nurture' as const, label: t('leadRow.statusNurture', 'Nurture') },
      { value: 'disqualified' as const, label: t('leadRow.statusDisqualified', 'Disqualified') },
      { value: 'converted' as const, label: t('leadRow.statusConverted', 'Converted') },
    ],
    [t],
  );

  const leadPriorityOpts = useMemo(
    () => [
      { value: 'low' as const, label: t('leadRow.priorityLow', 'Low') },
      { value: 'medium' as const, label: t('leadRow.priorityMedium', 'Medium') },
      { value: 'high' as const, label: t('leadRow.priorityHigh', 'High') },
      { value: 'critical' as const, label: t('leadRow.priorityCritical', 'Critical') },
    ],
    [t],
  );

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
              ? t('leadRow.deselectLead', 'Deselect {{name}}', {
                  name: `${lead.firstName} ${lead.lastName}`,
                })
              : t('leadRow.selectLead', 'Select {{name}}', {
                  name: `${lead.firstName} ${lead.lastName}`,
                })}
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
        {canWrite ? (
          <InlineEditSelect
            value={lead.status}
            options={leadStatusOpts}
            onSave={(next) => onPatch({ status: next })}
            label={t('leadRow.editStatusLabel', 'Edit status for {{name}}', {
              name: `${lead.firstName} ${lead.lastName}`,
            })}
            display={(v) => <LeadStatusBadge status={v as LeadSummary['status']} />}
          />
        ) : (
          <LeadStatusBadge status={lead.status} />
        )}
      </td>
      {/* A2 — priority is inline-editable. */}
      <td className="px-4 py-3">
        {canWrite ? (
          <InlineEditSelect
            value={lead.priority}
            options={leadPriorityOpts}
            onSave={(next) => onPatch({ priority: next })}
            label={t('leadRow.editPriorityLabel', 'Edit priority for {{name}}', {
              name: `${lead.firstName} ${lead.lastName}`,
            })}
            display={(v) => <LeadPriorityBadge priority={v as LeadSummary['priority']} />}
          />
        ) : (
          <LeadPriorityBadge priority={lead.priority} />
        )}
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
          disabled={!canWrite}
          title={canWrite ? undefined : readOnlyHint}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          aria-label={
            canWrite
              ? t('leadRow.deleteLead', 'Delete {{name}}', {
                  name: `${lead.firstName} ${lead.lastName}`,
                })
              : `${t('leadRow.deleteLead', 'Delete {{name}}', { name: `${lead.firstName} ${lead.lastName}` })} — ${readOnlyHint}`
          }
        >
          {t('leadRow.delete', 'Delete')}
        </button>
      </td>
    </SpotlightTableRow>
  );
}
