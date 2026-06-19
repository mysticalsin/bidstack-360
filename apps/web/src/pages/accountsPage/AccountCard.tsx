// Memoized account card. Re-renders only when its own row data changes —
// prevents all N cards from repainting when a sibling moves in the grid.
import { memo } from 'react';

import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springLayout, springSnap } from '@/lib/motion';

import {
  healthLabel,
  healthTone,
  sourcePillsFor,
  techStackPillsFor,
  titleCase,
  type AccountRow,
} from './accountUtils';

export const AccountCard = memo(function AccountCard({
  row,
  index,
}: {
  row: AccountRow;
  index: number;
}) {
  const { t } = useTranslation('crm');
  const { formatMoneyMicros } = useFormatMoney();
  const { company, openDeals, pipelineMicros, totalDeals, health } = row;
  const sources = sourcePillsFor(company);
  const techPills = techStackPillsFor(company);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { ...springLayout, delay: Math.min(index, 16) * 0.028 },
      }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
      whileHover={{ y: -3 }}
      whileTap={{ y: -1, scale: 0.998 }}
    >
      <div className="account-card-shell">
        <Link
          to={`/accounts/${encodeURIComponent(company.id)}`}
          className="account-card"
          aria-label={t('account.openCockpitAria', 'Open {{name}} customer cockpit', {
            name: company.name,
          })}
        >
          {company.imageUrl ? (
            <img
              src={company.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="account-card-cover"
            />
          ) : null}
          <div className="account-card-head">
            <CompanyLogo
              name={company.name}
              logo={company.logo}
              domain={company.domain}
              size={52}
            />
            <div className="account-card-title">
              <div className="account-card-name">{company.name}</div>
              <div className="account-card-meta">
                {titleCase(company.industry ?? t('account.unknownIndustry', 'Unknown industry'))}
                {company.domain ? ` · ${company.domain}` : ''}
              </div>
            </div>
            <Badge tone={healthTone(health)}>{healthLabel(health)}</Badge>
          </div>

          <div
            className="account-card-sources"
            aria-label={t('account.dataSourcesAria', '{{name}} data sources', {
              name: company.name,
            })}
          >
            {sources.map((source, sourceIndex) => (
              <motion.span
                key={source}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...springSnap, delay: Math.min(sourceIndex, 4) * 0.035 }}
              >
                {source}
              </motion.span>
            ))}
          </div>

          <div className={`account-card-tech${techPills.length === 0 ? ' is-empty' : ''}`}>
            <Icon name="zap" size={13} ariaHidden />
            {techPills.length > 0 ? (
              techPills.map((tech) => <span key={tech}>{tech}</span>)
            ) : (
              <span>{t('account.techStackPending', 'Tech stack pending')}</span>
            )}
          </div>

          <dl className="account-card-stats">
            <div>
              <dt>{t('account.openDeals', 'Open deals')}</dt>
              <dd>
                <AnimatedMetric value={openDeals.toLocaleString()} />
              </dd>
            </div>
            <div>
              <dt>{t('account.pipeline', 'Pipeline')}</dt>
              <dd>
                <AnimatedMetric value={formatMoneyMicros(pipelineMicros, 'EUR')} />
              </dd>
            </div>
            <div>
              <dt>{t('account.totalDeals', 'Total deals')}</dt>
              <dd>
                <AnimatedMetric value={totalDeals.toLocaleString()} />
              </dd>
            </div>
            <div>
              <dt>{t('account.employees', 'Employees')}</dt>
              <dd>{company.employeeCount ? company.employeeCount.toLocaleString() : '—'}</dd>
            </div>
          </dl>

          <div className="account-card-signal-grid">
            <div className="account-card-confidence">
              <span>{t('account.confidence', 'Confidence')}</span>
              <strong>
                <AnimatedMetric value={`${Math.round(company.confidence * 100)}%`} />
              </strong>
            </div>
            <div className="account-card-coverage">
              <div>
                <span>{t('account.coverage', 'Coverage')}</span>
                <strong>
                  <AnimatedMetric value={`${row.coverage.score}%`} />
                </strong>
              </div>
              <span aria-hidden>
                <i style={{ width: `${row.coverage.score}%` }} />
              </span>
            </div>
            <div
              className={`account-card-insight${row.coverage.missing.length === 0 ? ' is-complete' : ''}`}
              aria-label={t(
                'account.coverageInsightAria',
                '{{name}} coverage insight: {{reason}} {{nextAction}}',
                {
                  name: company.name,
                  reason: row.coverage.reason,
                  nextAction: t('account.coverageNextAction', 'Next: {{nextAction}}', {
                    nextAction: row.coverage.nextAction,
                  }),
                },
              )}
            >
              <Icon
                name={row.coverage.missing.length === 0 ? 'checkCircle' : 'info'}
                size={14}
                ariaHidden
              />
              <span>{`${row.coverage.reason} `}</span>
              <strong>
                {t('account.coverageNextAction', 'Next: {{nextAction}}', {
                  nextAction: row.coverage.nextAction,
                })}
              </strong>
            </div>
          </div>

          <div className="account-card-foot">
            {t('account.openAccountCockpit', 'Open account cockpit')}{' '}
            <Icon name="arrow" size={11} />
          </div>
        </Link>
      </div>
    </motion.div>
  );
});
