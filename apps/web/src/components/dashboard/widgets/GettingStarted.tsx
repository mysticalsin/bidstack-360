import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '@/components/ui/Icon';
import { springSoft } from '@/lib/motion';
import { useOnboardingStore } from '@/stores/onboarding';

// ─── GettingStarted ──────────────────────────────────────────────────────────
// First-run state for a brand-new org with zero records. Instead of a barren
// command center reading "0 companies · 0 open deals", we surface the first
// three moves that get a bid pilot off the ground. Each card deep-links to the
// real screen — no dead ends. Copy is bid-piloting specific, not generic CRM.

interface StartCard {
  icon: IconName;
  title: string;
  body: string;
  cta: string;
  to: string;
}

export function GettingStarted() {
  const { t } = useTranslation('crm');
  const reduced = useReducedMotion();
  const openTemplatePicker = useOnboardingStore((s) => s.openTemplatePicker);

  const cards: StartCard[] = [
    {
      icon: 'building',
      title: t('orgDashboard.gettingStarted.accountTitle', 'Add your first account'),
      body: t(
        'orgDashboard.gettingStarted.accountBody',
        'Bring in the company you are bidding into so the cockpit can pull together its contacts, risks, and history.',
      ),
      cta: t('orgDashboard.gettingStarted.accountCta', 'Add an account'),
      to: '/companies',
    },
    {
      icon: 'briefcase',
      title: t('orgDashboard.gettingStarted.opportunityTitle', 'Open your first opportunity'),
      body: t(
        'orgDashboard.gettingStarted.opportunityBody',
        'Log the bid you are pursuing. BidStack tracks its stage, value, and win probability from qualification to signature.',
      ),
      cta: t('orgDashboard.gettingStarted.opportunityCta', 'Open an opportunity'),
      to: '/opportunities',
    },
    {
      icon: 'target',
      title: t('orgDashboard.gettingStarted.bidMatrixTitle', 'Score a bid/no-bid'),
      body: t(
        'orgDashboard.gettingStarted.bidMatrixBody',
        'Before you commit a team, weigh the opportunity on fit, value, and win probability with the Bid/No-Bid Matrix.',
      ),
      cta: t('orgDashboard.gettingStarted.bidMatrixCta', 'Run the matrix'),
      to: '/bid-matrix',
    },
  ];

  return (
    <motion.section
      aria-labelledby="getting-started-heading"
      className="mx-auto max-w-3xl py-10"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={springSoft}
    >
      <div className="mb-8 text-center">
        <div className="mb-2 text-xs font-medium text-[var(--brand-primary)]">
          {t('orgDashboard.gettingStarted.eyebrow', 'Your workspace is ready')}
        </div>
        <h1
          id="getting-started-heading"
          className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]"
        >
          {t('orgDashboard.gettingStarted.title', "Let's pilot your first bid")}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--fg-secondary)]">
          {t(
            'orgDashboard.gettingStarted.subtitle',
            'There is nothing here yet. Make one of these three moves and the command center fills in as you go.',
          )}
        </p>
      </div>

      <ul className="space-y-3" role="list">
        {cards.map((card, i) => (
          <li key={card.to}>
            <Reveal index={i} reduced={reduced}>
              <Link
                to={card.to}
                className="group flex min-h-[44px] items-start gap-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 text-left transition-all hover:border-[var(--brand)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              >
                <span
                  className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--brand-primary)] transition-colors group-hover:bg-[var(--brand)]/10"
                  aria-hidden
                >
                  <Icon name={card.icon} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--fg-primary)]">{card.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{card.body}</p>
                </div>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)]">
                  {card.cta}
                  <Icon
                    name="chevron-right"
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                    ariaHidden
                  />
                </span>
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" className="btn btn-secondary" onClick={openTemplatePicker}>
          <Icon name="sparkle" size={14} />
          {t('orgDashboard.gettingStarted.templateCta', 'Start from a template')}
        </button>
        <Link to="/quick-start" className="btn btn-secondary">
          <Icon name="play" size={14} />
          {t('orgDashboard.gettingStarted.tourCta', 'See the full checklist')}
        </Link>
      </div>
    </motion.section>
  );
}

// Tiny per-card entrance stagger. Kept local — the shared Reveal staggers on
// scroll, but here we want a fixed first-paint cascade.
function Reveal({
  index,
  reduced,
  children,
}: {
  index: number;
  reduced: boolean | null;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ ...springSoft, delay: reduced ? 0 : 0.05 + index * 0.06 }}
    >
      {children}
    </motion.div>
  );
}
