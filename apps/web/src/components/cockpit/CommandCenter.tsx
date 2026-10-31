import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import type { BadgeTone } from '@/components/ui/Badge';
import { springSnap, springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, RiskItem } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

interface CommandSignal {
  label: string;
  value: string;
  detail: string;
  progress: number | null;
  tone: BadgeTone;
}

export const CommandCenter = memo(function CommandCenter({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const readiness = deriveReadiness(cockpit);
  const nextMove = deriveNextMove(cockpit, t);
  const committee = deriveCommittee(cockpit, t);
  const recordedRisks = cockpit.risks.length;
  const openRisks = cockpit.risks.filter((risk) => risk.status !== 'mitigated').length;
  const criticalRisks = cockpit.risks.filter(
    (risk) => risk.severity === 'critical' || risk.severity === 'high',
  ).length;
  const attributionCount = cockpit.company.sourceAttribution.length;
  const hasLogo = Boolean(cockpit.company.logo);
  const proofCount = sourceReceiptTotal(attributionCount, hasLogo);

  const signals: CommandSignal[] = [
    {
      label: t('commandCenter.signal.readiness.label', 'Bid readiness proxy'),
      value: `${readiness}%`,
      detail: t(
        'commandCenter.signal.readiness.detail',
        'weighted mix of recorded signals on this account, not a measured score',
      ),
      progress: readiness,
      tone: readiness >= 85 ? 'jade' : readiness >= 68 ? 'blue' : 'amber',
    },
    {
      label: t('commandCenter.signal.source.label', 'Source receipts'),
      value: proofCount.toLocaleString(),
      detail: hasLogo
        ? t(
            'commandCenter.signal.source.detailWithLogo',
            '{{attribution}} attribution receipt and 1 stored logo. Not a coverage percent.',
            { attribution: attributionCount },
          )
        : t(
            'commandCenter.signal.source.detail',
            '{{count}} attribution receipts. Not a coverage percent.',
            { count: proofCount },
          ),
      progress: null,
      tone: proofCount >= 5 ? 'jade' : proofCount >= 3 ? 'blue' : 'amber',
    },
    {
      label: t('commandCenter.signal.decision.label', 'Influence map'),
      value: t('commandCenter.signal.decision.value', '{{score}}/5 proxy', {
        score: committee.influence,
      }),
      detail: committee.summary,
      progress: committee.influence * 20,
      tone: committee.influence >= 4 ? 'jade' : committee.influence >= 3 ? 'blue' : 'amber',
    },
    {
      label: t('commandCenter.signal.risk.label', 'Open risk load'),
      value: recordedRisks === 0
        ? t('commandCenter.signal.risk.valueNone', 'None recorded')
        : criticalRisks
          ? t('commandCenter.signal.risk.valueHigh', '{{count}} high', { count: criticalRisks })
          : t('commandCenter.signal.risk.valueOpen', '{{count}} open', { count: openRisks }),
      detail: recordedRisks === 0
        ? t('commandCenter.signal.risk.detailNone', 'no risk rows on this account')
        : criticalRisks
          ? t('commandCenter.signal.risk.detailEscalate', 'escalate before proposal')
          : openRisks
            ? t('commandCenter.signal.risk.detailManageable', 'manageable with owner follow-up')
            : t('commandCenter.signal.risk.detailNoneOpen', 'recorded register has no open risks'),
      progress: recordedRisks === 0 ? null : riskLoadProgress(openRisks, criticalRisks),
      tone: recordedRisks === 0 ? 'amber' : criticalRisks ? 'tomato' : openRisks ? 'amber' : 'jade',
    },
  ];

  return (
    <motion.section
      className="command-center command-center-graphic"
      role="region"
      aria-label={t('commandCenter.region.ariaLabel', 'Polo PreSales command center')}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
    >
      <p className="command-center-next">{nextMove}</p>
      <div className="command-center-metrics">
        {signals.map((signal, index) => (
          <motion.div
            key={signal.label}
            className="command-signal"
            data-tone={signal.tone}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.045 }}
          >
            <div className="command-signal-head">
              <span>{signal.label}</span>
            </div>
            <strong>
              <AnimatedMetric value={signal.value} />
            </strong>
            {signal.progress != null ? (
              <span className="command-progress" aria-hidden>
                <motion.span
                  initial={{ width: reducedMotion ? `${signal.progress}%` : '0%' }}
                  animate={{ width: `${signal.progress}%` }}
                  transition={{ ...springSnap, delay: reducedMotion ? 0 : 0.14 + index * 0.04 }}
                />
              </span>
            ) : null}
            <span className="command-signal-detail">{signal.detail}</span>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
});

function deriveReadiness(cockpit: AccountCockpitSnapshot): number {
  const health = cockpit.health.score;
  const compliance =
    cockpit.compliance.length === 0
      ? 0
      : (cockpit.compliance.filter((item) => item.status === 'compliant').length /
          cockpit.compliance.length) *
        100;
  const sources = Math.min(
    100,
    sourceReceiptTotal(cockpit.company.sourceAttribution.length, Boolean(cockpit.company.logo)) * 18,
  );
  const contacts = Math.min(
    100,
    cockpit.keyContacts.reduce((acc, person) => acc + (person.influence ?? 0), 0) * 12,
  );
  const riskPenalty = cockpit.risks.reduce((acc, risk) => acc + riskPenaltyFor(risk), 0);
  return clamp(
    Math.round(health * 0.34 + compliance * 0.26 + sources * 0.2 + contacts * 0.2 - riskPenalty),
  );
}

function deriveNextMove(cockpit: AccountCockpitSnapshot, t: TFunction): string {
  const blocker = cockpit.compliance.find((item) => item.status === 'blocked');
  if (blocker)
    return t('commandCenter.nextMove.unblock', 'Unblock {{label}} before the bid gate.', {
      label: blocker.label,
    });

  const urgentRisk = cockpit.risks.find(
    (risk) =>
      risk.status !== 'mitigated' && (risk.severity === 'critical' || risk.severity === 'high'),
  );
  if (urgentRisk) {
    return urgentRisk.owner
      ? t(
          'commandCenter.nextMove.escalateWithOwner',
          'Escalate {{title}} with {{owner}} before proposal approval.',
          { title: urgentRisk.title, owner: urgentRisk.owner },
        )
      : t(
          'commandCenter.nextMove.escalate',
          'Escalate {{title}} before proposal approval.',
          { title: urgentRisk.title },
        );
  }

  const champion = cockpit.keyContacts.find((person) => person.roleInDecision === 'champion');
  if (champion)
    return t(
      'commandCenter.nextMove.champion',
      'Use {{name}} as champion for the next presales milestone.',
      { name: champion.name },
    );

  if (cockpit.company.sourceAttribution.length < 3) {
    return t(
      'commandCenter.nextMove.refreshSources',
      'Refresh data verification to strengthen legal, logo, market, and account-source proof.',
    );
  }

  return t(
    'commandCenter.nextMove.advance',
    'Advance the next proposal step with available account context and owner alignment.',
  );
}

function deriveCommittee(
  cockpit: AccountCockpitSnapshot,
  t: TFunction,
): {
  contacts: number;
  influence: number;
  summary: string;
} {
  const contacts = cockpit.keyContacts.length;
  const influence = influenceProxyScore(cockpit.keyContacts);
  const champions = cockpit.keyContacts.filter(
    (person) => person.roleInDecision === 'champion',
  ).length;
  const buyers = cockpit.keyContacts.filter((person) => person.roleInDecision === 'buyer').length;
  const summary =
    champions > 0
      ? t('commandCenter.committee.champions', '{{count}} champion mapped', { count: champions })
      : buyers > 0
        ? t('commandCenter.committee.buyers', '{{count}} buyer mapped', { count: buyers })
        : contacts > 0
          ? t('commandCenter.committee.stakeholders', '{{count}} stakeholder mapped', {
              count: contacts,
            })
          : t('commandCenter.committee.empty', 'map buyer and champion');
  return { contacts, influence, summary };
}

/** A stored logo is one receipt. The number matches the sentence under it. */
export function sourceReceiptTotal(attributionCount: number, hasLogo: boolean): number {
  return attributionCount + (hasLogo ? 1 : 0);
}

/** An empty buying group is 0. Missing influence is not a point. */
export function influenceProxyScore(
  people: readonly { influence: number | null }[],
): number {
  const total = people.reduce((acc, person) => acc + (person.influence ?? 0), 0);
  if (people.length === 0 || total === 0) return 0;
  return Math.min(5, Math.round(total / 2));
}

/** Bar fill follows open load. Zero open risks is an empty bar. */
export function riskLoadProgress(openRisks: number, criticalRisks: number): number {
  return Math.min(100, criticalRisks * 26 + openRisks * 7);
}

function riskPenaltyFor(risk: RiskItem): number {
  if (risk.status === 'mitigated' || risk.status === 'accepted') return 0;
  if (risk.severity === 'critical') return 14;
  if (risk.severity === 'high') return 9;
  if (risk.severity === 'medium') return 4;
  return 1;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
