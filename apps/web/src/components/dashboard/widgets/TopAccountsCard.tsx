/**
 * dashboard/widgets/TopAccountsCard.tsx — animated top-5 accounts list for
 * the OrgDashboard main column.
 *
 * WHY a separate module: TopAccountsCard has its own stagger animation and
 * CompanyLogo dependency (~58 source lines). Extracting it keeps company-
 * specific presentation isolated from the general dashboard shell.
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { springSoft } from '@/lib/motion';
import type { CrmCompany } from '@bidstack/shared';

// ─── TopAccountsCard ─────────────────────────────────────────────────────────

export function TopAccountsCard({
  companies,
}: {
  companies: Array<Pick<CrmCompany, 'id' | 'name' | 'industry' | 'domain' | 'logo'>>;
}) {
  return (
    <GlassCard padding="md" hoverable={false}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
            <Icon name="crown" size={13} className="text-[var(--tag-amber-fg)]" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Top accounts</h2>
        </div>
        <Link to="/accounts" className="text-xs text-[var(--brand-primary)] hover:underline">
          View all
        </Link>
      </div>
      <div className="space-y-1">
        {companies.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springSoft, delay: i * 0.04 }}
          >
            <Link
              to={`/accounts/${c.id}`}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-hover)] transition-colors group"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <CompanyLogo name={c.name} logo={c.logo} domain={c.domain} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--fg-primary)]">
                  {c.name}
                </div>
                <div className="truncate text-xs text-[var(--fg-tertiary)]">
                  {c.industry && c.industry !== 'Unknown industry'
                    ? c.industry
                    : c.domain
                      ? c.domain
                      : 'Portfolio account'}
                </div>
              </div>
              <Icon
                name="chevron-right"
                size={14}
                className="text-[var(--fg-tertiary)] group-hover:text-[var(--brand-primary)] transition-colors"
              />
            </Link>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}
