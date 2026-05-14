import { motion, useReducedMotion } from 'framer-motion';
import { memo, type CSSProperties } from 'react';

import type {
  CategorySalesRow,
  CountrySalesRow,
  MonthlySalesPoint,
  ProductSalesRow,
  SalesIntelligenceReport,
  SalesMetricKpi,
  SalesRankRow,
} from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import type { useSalesIntelligence } from '@/hooks/useSalesIntelligence';
import { formatMoney, formatStage } from '@/lib/format';
import { springSnap, springSoft } from '@/lib/motion';

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
    <section className="sales-intel" aria-label="Sales intelligence">
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

function MetricTile({
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

function MonthlySalesChart({
  points,
  currencyCode,
  reducedMotion,
}: {
  points: MonthlySalesPoint[];
  currencyCode: string;
  reducedMotion: boolean;
}) {
  const chart = chartGeometry(points);
  if (!chart) {
    return <EmptyState title="No monthly sales yet" />;
  }

  return (
    <div className="sales-chart-wrap">
      <svg
        className="sales-area-chart"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="Monthly sales revenue chart"
      >
        <defs>
          <linearGradient id="sales-area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(44, 75, 255, 0.34)" />
            <stop offset="100%" stopColor="rgba(44, 75, 255, 0.04)" />
          </linearGradient>
        </defs>
        {chart.grid.map((y) => (
          <line key={y} x1={chart.pad} x2={chart.width - chart.pad} y1={y} y2={y} />
        ))}
        <motion.path
          d={chart.areaPath}
          className="sales-area-fill"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...springSoft, delay: reducedMotion ? 0 : 0.08 }}
        />
        <motion.polyline
          points={chart.linePoints}
          className="sales-area-line"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, pathLength: 0 }}
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, pathLength: 1 }}
          transition={{ ...springSoft, delay: reducedMotion ? 0 : 0.14 }}
        />
        {chart.points.map((point) => (
          <motion.circle
            key={point.label}
            cx={point.x}
            cy={point.y}
            r="3.5"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={springSnap}
          />
        ))}
      </svg>
      <div className="sales-chart-axis">
        {points.map((point) => (
          <span key={point.month}>
            {point.label}
            <strong>{formatCompactMicros(point.revenueMicros, currencyCode)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function CountryPanel({
  countries,
  currencyCode,
  reducedMotion,
}: {
  countries: CountrySalesRow[];
  currencyCode: string;
  reducedMotion: boolean;
}) {
  if (countries.length === 0) return <EmptyState title="No country data yet" />;
  const top = countries[0];
  const maxRevenue = Math.max(...countries.map((country) => country.revenueMicros), 1);

  return (
    <div className="sales-country-shell">
      <div className="sales-country-map" aria-label="Country revenue heat map">
        {countries.slice(0, 6).map((country, index) => (
          <motion.div
            key={country.countryCode}
            className="sales-country-bubble"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={reducedMotion ? undefined : { y: -2, scale: 1.02 }}
            transition={{ ...springSnap, delay: reducedMotion ? 0 : index * 0.035 }}
            style={
              {
                '--bubble-size': `${48 + Math.round((country.revenueMicros / maxRevenue) * 72)}px`,
                '--bubble-alpha': `${18 + Math.round((country.revenueMicros / maxRevenue) * 36)}%`,
              } as CSSProperties
            }
          >
            <span>{country.countryCode}</span>
            <strong>{index + 1}</strong>
          </motion.div>
        ))}
      </div>

      <div className="sales-country-list">
        {countries.slice(0, 5).map((country) => (
          <article key={country.countryCode} className="sales-country-row">
            <div className="sales-country-main">
              <div>
                <strong>{country.countryName}</strong>
                <span>
                  {country.customerCount} accounts · {country.orderCount} orders ·{' '}
                  {country.quotationCount} quotes
                </span>
              </div>
              <b>{formatCompactMicros(country.revenueMicros, currencyCode)}</b>
            </div>
            <div className="sales-country-bar">
              <motion.span
                initial={{ width: reducedMotion ? `${Math.max(6, country.sharePct)}%` : '0%' }}
                animate={{ width: `${Math.max(6, country.sharePct)}%` }}
                transition={springSoft}
              />
            </div>
            <div className="sales-country-people">
              {(country.people.length > 0
                ? country.people.slice(0, 3)
                : country.topCustomers.map((customer) => ({
                    name: customer,
                    customer,
                    title: null,
                    email: null,
                  }))
              ).map((person) => (
                <span key={`${country.countryCode}-${person.customer}-${person.name}`}>
                  {person.name} · {person.customer}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      {top ? (
        <div className="sales-country-foot">
          <span>Leader</span>
          <strong>
            {top.countryName} · {top.topCustomers.slice(0, 2).join(', ')}
          </strong>
        </div>
      ) : null}
    </div>
  );
}

function RankingCard({
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
                <th>Customer</th>
                <th>Salesperson</th>
                <th>Revenue</th>
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

function ProductCard({
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

function CategoryCard({
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
  share,
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
          animate={{ width: `${Math.max(5, Math.min(100, share))}%` }}
          transition={springSoft}
        />
      </div>
    </div>
  );
}

function chartGeometry(points: MonthlySalesPoint[]) {
  if (points.length === 0) return null;
  const width = 720;
  const height = 220;
  const pad = 30;
  const max = Math.max(...points.map((point) => point.revenueMicros), 1);
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: pad + index * step,
    y: height - pad - (point.revenueMicros / max) * (height - pad * 2),
    label: point.month,
  }));
  const linePoints = coords.map((point) => `${point.x},${point.y}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || !last) return null;
  const areaPath = `M ${first.x} ${height - pad} L ${linePoints.replaceAll(' ', ' L ')} L ${last.x} ${height - pad} Z`;
  const grid = [0.2, 0.4, 0.6, 0.8].map((n) => pad + (height - pad * 2) * n);
  return { width, height, pad, points: coords, linePoints, areaPath, grid };
}

function formatMicros(micros: number, currencyCode: string): string {
  return formatMoney(micros / 1_000_000, currencyCode);
}

function formatCompactMicros(micros: number, currencyCode: string): string {
  const value = micros / 1_000_000;
  const formatted = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
  return `${currencyCode}${formatted}`;
}

function formatTrend(percent: number): string {
  if (percent === 0) return '0.0%';
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

function sourceCaption(report: SalesIntelligenceReport): string {
  return report.sourceAttribution[0]?.label ?? 'BidStack sales intelligence';
}

function share(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((value / max) * 100);
}
