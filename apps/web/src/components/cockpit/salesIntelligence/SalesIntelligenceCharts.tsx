// SVG area chart and country bubble/bar panel for SalesIntelligencePanel.
import { motion } from 'framer-motion';
import type { CSSProperties } from 'react';

import type { CountrySalesRow, MonthlySalesPoint } from '@bidstack/shared';

import { EmptyState } from '@/components/ui/StateMessages';
import { springSnap, springSoft } from '@/lib/motion';

import { chartGeometry, formatCompactMicros } from './salesIntelligenceUtils';

export function MonthlySalesChart({
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

export function CountryPanel({
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
