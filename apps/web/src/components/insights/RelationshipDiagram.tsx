import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';

import { SankeyChart, SankeyLink, SankeyNode, SankeyTooltip } from '@/components/charts/sankey';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCompany } from '@/hooks/useCompanies';
import { useInsightCompanies } from '@/hooks/useInsightsData';

import { InsightFrame } from './InsightFrame';
import { CountTable } from './PipelineStageChart';
import { insightErrorText, shapeCompanyRelationships } from './shapeInsights';

export function RelationshipDiagram() {
  const reduced = useReducedMotion();
  const companies = useInsightCompanies();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const items = companies.data?.items ?? [];
  const selectedId = pickedId ?? items[0]?.id ?? null;
  const company = useCompany(selectedId ?? undefined);
  const contacts = company.data?.contacts ?? [];
  const diagram = company.data ? shapeCompanyRelationships(company.data.name, contacts) : null;

  const frameStatus = companies.isPending
    ? 'loading'
    : companies.isError
      ? 'error'
      : items.length === 0
        ? 'empty'
        : 'ready';

  return (
    <InsightFrame
      title="Relationships"
      caption="Each band is one contact linked to the company. Width is that link, not revenue."
      status={frameStatus}
      errorMessage={insightErrorText(companies.error)}
      onRetry={() => void companies.refetch()}
      emptyTitle="No companies yet"
      emptyMessage="Add a company before mapping the people on it."
      emptyIcon="contacts"
    >
      {frameStatus === 'ready' ? (
        <div className="flex flex-col gap-4 px-4 py-4">
          <label className="flex flex-col gap-2 text-xs text-[var(--fg-secondary)]">
            Company
            <select
              value={selectedId ?? ''}
              onChange={(event) => setPickedId(event.target.value)}
              className="min-h-11 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {company.isPending ? <LoadingSkeleton rows={3} /> : null}
          {company.isError ? (
            <ErrorState
              title="Could not load people for this company"
              message={insightErrorText(company.error)}
              action={
                <Button type="button" variant="secondary" size="lg" onClick={() => void company.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : null}
          {company.isSuccess && !diagram ? (
            <EmptyState
              title="No contacts linked to this company"
              message="People show up here only when a contact is linked to the selected company."
              icon="contacts"
            />
          ) : null}
          {diagram ? (
            <>
              <div className="overflow-x-auto" aria-hidden="true">
                <div className="min-w-[640px]">
                <SankeyChart
                  data={{
                    nodes: diagram.nodes,
                    links: diagram.links.map((link) => ({
                      source: link.source,
                      target: link.target,
                      value: link.value,
                    })),
                  }}
                  aspectRatio={`2 / ${Math.max(1, diagram.links.length * 0.45)}`}
                  nodePadding={16}
                  animationDuration={reduced ? 0 : 500}
                  margin={{ top: 24, right: 180, bottom: 24, left: 180 }}
                >
                  <SankeyLink />
                  <SankeyNode showValueLabels={false} labelOrientation="horizontal" />
                  <SankeyTooltip
                    formatValue={(value) => (value === 1 ? '1 contact' : `${value} contacts`)}
                  />
                </SankeyChart>
                </div>
              </div>
              <CountTable
                caption="Contacts linked to the selected company"
                headers={['Person', 'Role', 'Link']}
                rows={contacts.map((contact) => [contact.name, contact.role ?? '—', '1 contact'])}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </InsightFrame>
  );
}
