import { AccountDistributionChart } from '@/components/insights/AccountDistributionChart';
import { PipelineStageChart } from '@/components/insights/PipelineStageChart';
import { RelationshipDiagram } from '@/components/insights/RelationshipDiagram';

/** CRM scan for presales, GAM, and KAM. Figures come from live records only. */
export default function WorkspaceInsightsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="page-title">CRM Insights</h1>
        <p className="max-w-2xl text-sm text-[var(--fg-secondary)]">
          Pipeline, accounts, and people from current CRM records. Counts are record counts.
          Amounts stay unlabeled when the API does not send a currency.
        </p>
      </header>
      <PipelineStageChart />
      <AccountDistributionChart />
      <RelationshipDiagram />
    </div>
  );
}
