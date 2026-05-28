// KPI tile, ranking, product, and category card components for the
// SalesIntelligencePanel. BarRow is file-private (used only by ProductCard
// and CategoryCard in this module).
import { motion } from 'framer-motion';

import type {
  CategorySalesRow,
  ProductSalesRow,
  SalesMetricKpi,
  SalesRankRow,
} from '@bidstack/shared';

import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';
import { formatStage } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import { formatCompactMicros, formatMicros, formatTrend, share } from './salesIntelligenceUtils';

export function MetricTile({
  kpi,
  reportCurrency,
  index,
  reducedMotion,
}: {
  kpi: SalesMetricKpi;
  reportCurrency: string;
  index: number;
  reducedMotion: boolean;
}) {
  const value =
    kpi.kind === 'money'
      ? formatCompactMicros(kpi.value, kpi.currencyCode ?? reportCurrency)
      : new Intl.NumberFormat('en-US').format(kpi.value);
  const trendClass =
    kpi.trend === 'up' ? 'sales-trend-up' : kpi.trend === 'down' ? 'sales-trend-down' : '';

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reducedMotion ? undefined : { y: -2 }}
      transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
    >
      <Card className={`sales-kpi sales-kpi-${kpi.tone}`}>
        <div className="sales-kpi-label">{kpi.label}</div>
        <div className="sales-kpi-value">{value}</div>
        <div className={`sales-kpi-trend ${trendClass}`}>
          {formatTrend(kpi.percentChange)} since prior quarter
        </div>
      </Card>
    </motion.div>
  );
}

export function RankingCard({
  title,
  rows,
  currencyCode,
}: {
  title: string;
  rows: SalesRankRow[];
  currencyCode: string;
}) {
  return (
    <Card>
      <SectionHeader title={title} />
      {rows.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} yet`} />
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-rank-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Salesperson</th>
                <th scope="col">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="sales-customer">{row.customer}</span>
                    <small>{row.number ?? formatStage(row.state)}</small>
                  </td>
                  <td>{row.salesperson ?? 'Unassigned'}</td>
                  <td>{formatMicros(row.revenueMicros, row.currencyCode ?? currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ProductCard({
  products,
  currencyCode,
}: {
  products: ProductSalesRow[];
  currencyCode: string;
}) {
  return (
    <Card>
      <SectionHeader title="Top products" />
      <div className="sales-product-list">
        {products.length === 0 ? (
          <EmptyState title="No products yet" />
        ) : (
          products
            .slice(0, 8)
            .map((product) => (
              <BarRow
                key={product.product}
                label={product.product}
                sublabel={product.category}
                count={product.orderCount}
                value={formatMicros(product.revenueMicros, product.currencyCode ?? currencyCode)}
                share={share(product.revenueMicros, products[0]?.revenueMicros ?? 1)}
              />
            ))
        )}
      </div>
    </Card>
  );
}

export function CategoryCard({
  categories,
  currencyCode,
}: {
  categories: CategorySalesRow[];
  currencyCode: string;
}) {
  return (
    <Card>
      <SectionHeader
        title="Top categories"
        action={<span className="sales-tabs">Treemap&nbsp;&nbsp;Top 10</span>}
      />
      <div className="sales-product-list">
        {categories.length === 0 ? (
          <EmptyState title="No categories yet" />
        ) : (
          categories
            .slice(0, 8)
            .map((category) => (
              <BarRow
                key={category.category}
                label={category.category}
                sublabel={`${category.sharePct.toFixed(1)}% of visible revenue`}
                count={category.orderCount}
                value={formatMicros(category.revenueMicros, category.currencyCode ?? currencyCode)}
                share={category.sharePct}
              />
            ))
        )}
      </div>
    </Card>
  );
}

function BarRow({
  label,
  sublabel,
  count,
  value,
  share: sharePct,
}: {
  label: string;
  sublabel: string;
  count: number;
  value: string;
  share: number;
}) {
  return (
    <div className="sales-bar-row">
      <div>
        <strong>{label}</strong>
        <span>{sublabel}</span>
      </div>
      <div className="sales-bar-meta">
        <span>{count}</span>
        <b>{value}</b>
      </div>
      <div className="sales-product-bar">
        <motion.span
          initial={{ width: '0%' }}
          animate={{ width: `${Math.max(5, Math.min(100, sharePct))}%` }}
          transition={springSoft}
        />
      </div>
    </div>
  );
}
