/**
 * KamAccountPage — the Key Account Management cockpit for one account.
 *
 * Pick an account, then see its KPIs, the Initiative board (locked state
 * machine), the per-account to-do (the OM gap), and the human-gate review queue
 * for AI-organized workshop drafts. Matches the CRM design language.
 */
import { useState } from 'react';

import { EmptyState } from '@/components/ui/StateMessages';
import { useCompanies } from '@/hooks/useCompanies';

import { KamDraftReview, KamInitiativeBoard, KamKpiStrip, KamTodoCard } from './kamPanels';

export default function KamAccountPage() {
  const { data, isLoading } = useCompanies();
  const [companyId, setCompanyId] = useState('');
  const accounts = data?.items ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--fg-primary)]">Key Account Management</h1>
          <p className="mt-0.5 text-sm text-[var(--fg-secondary)]">
            Capture workshop initiatives, track them to a qualified opportunity, and hand off to OM.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--fg-tertiary)]">Account</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={isLoading}
            className="min-h-9 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          >
            <option value="">{isLoading ? 'Loading…' : 'Select an account…'}</option>
            {accounts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {companyId ? (
        <div className="space-y-4">
          <KamKpiStrip companyId={companyId} />
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <KamInitiativeBoard companyId={companyId} />
            </div>
            <div className="space-y-4">
              <KamDraftReview companyId={companyId} />
              <KamTodoCard companyId={companyId} />
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          title="Select an account"
          message="Choose a key account above to see its initiatives, to-dos, KPIs, and workshop drafts."
        />
      )}
    </div>
  );
}
