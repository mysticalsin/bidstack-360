import { memo } from 'react';
import { useReducedMotion } from 'framer-motion';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import type { useSalesIntelligence } from '@/hooks/useSalesIntelligence';

import {
  CategoryCard,
  MetricTile,
  ProductCard,
  RankingCard,
} from './salesIntelligence/SalesIntelligenceCards';
import { CountryPanel, MonthlySalesChart } from './salesIntelligence/SalesIntelligenceCharts';
import { sourceCaption } from './salesIntelligence/salesIntelligenceUtils';

interface Props {
  report: ReturnType<typeof useSalesIntelligence>;
}

export const SalesIntelligencePanel = memo(function SalesIntelligencePanel({ report }: Props) {
  const reducedMotion = useReducedMotion();

  if (report.isLoading) {
    return (
      <Card>
        <SectionHeader title="Sales intelligence" />
        <LoadingSkeleton rows={6} />
      </Card>
    );
  }

  if (report.isError || !report.data) {
    return (
      <Card>
        <SectionHeader title="Sales intelligence" />
        <EmptyState title="Sales intelligence is unavailable" />
      </Card>
    );
  }

  const data = report.data;

  return (
    <section className="sales-intel" aria-label="Portfolio sales intelligence">
      <div className="section-kicker">
        Portfolio sales intelligence
        <span>All-account sales and quotation signals</span>
      </div>
      <div className="sales-kpis">
        {data.kpis.map((kpi, index) => (
          <MetricTile
            key={kpi.id}
            kpi={kpi}
            reportCurrency={data.currencyCode}
            index={index}
            reducedMotion={Boolean(reducedMotion)}
          />
        ))}
      </div>

      <div className="sales-panel-grid">
        <Card className="sales-card-wide">
          <SectionHeader
            title="Monthly sales"
            caption={sourceCaption(data)}
            action={
              <Badge tone={data.source === 'sales_orders' ? 'jade' : 'blue'}>{data.source}</Badge>
            }
          />
          <MonthlySalesChart
            points={data.monthlySales}
            currencyCode={data.currencyCode}
            reducedMotion={Boolean(reducedMotion)}
          />
        </Card>

        <Card>
          <SectionHeader
            title="Top countries"
            action={<span className="sales-tabs">Map&nbsp;&nbsp;Top 10</span>}
          />
          <CountryPanel
            countries={data.topCountries}
            currencyCode={data.currencyCode}
            reducedMotion={Boolean(reducedMotion)}
          />
        </Card>
      </div>

      <div className="sales-two-col">
        <RankingCard
          title="Top quotations"
          rows={data.topQuotations}
          currencyCode={data.currencyCode}
        />
        <RankingCard
          title="Top sales orders"
          rows={data.topOrders}
          currencyCode={data.currencyCode}
        />
      </div>

      <div className="sales-two-col">
        <ProductCard products={data.topProducts} currencyCode={data.currencyCode} />
        <CategoryCard categories={data.topCategories} currencyCode={data.currencyCode} />
      </div>
    </section>
  );
});
