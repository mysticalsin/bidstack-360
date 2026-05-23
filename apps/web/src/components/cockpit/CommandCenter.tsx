import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { formatMoneyMicros } from '@/lib/format';
import { springSnap, springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, RiskItem } from '@bidstack/shared';

import { labelForBand } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

interface CommandSignal {
  label: string;
  value: string;
  detail: string;
  progress: number;
  tone: BadgeTone;
}

export const CommandCenter = memo(function CommandCenter({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const readiness = deriveReadiness(cockpit);
  const nextMove = deriveNextMove(cockpit);
  const committee = deriveCommittee(cockpit);
  const openRisks = cockpit.risks.filter((risk) => risk.status !== 'mitigated').length;
  const criticalRisks = cockpit.risks.filter(
    (risk) => risk.severity === 'critical' || risk.severity === 'high',
  ).length;
  const proofCount = cockpit.company.sourceAttribution.length + (cockpit.company.logo ? 1 : 0);
  const stackCount = cockpit.technicalStack.reduce((acc, row) => acc + row.items.length, 0);
  const primaryKpi = cockpit.kpis[0];

  const signals: CommandSignal[] = [
    {
      label: 'Bid readiness estimate',
      value: `${readiness}%`,
      detail: readiness >= 85 ? 'ready for exec review' : 'needs presales focus',
      progress: readiness,
      tone: readiness >= 85 ? 'jade' : readiness >= 68 ? 'blue' : 'amber',
    },
    {
      label: 'Source coverage',
      value: proofCount.toLocaleString(),
      detail: `${cockpit.company.sourceAttribution.length} attributed source${cockpit.company.sourceAttribution.length === 1 ? '' : 's'}`,
      progress: Math.min(100, proofCount * 16),
      tone: proofCount >= 5 ? 'jade' : proofCount >= 3 ? 'blue' : 'amber',
    },
    {
      label: 'Decision coverage',
      value: `${committee.influence}/5`,
      detail: committee.summary,
      progress: committee.influence * 20,
      tone: committee.influence >= 4 ? 'jade' : committee.influence >= 3 ? 'blue' : 'amber',
    },
    {
      label: 'Open risk load',
      value: criticalRisks ? `${criticalRisks} high` : `${openRisks} open`,
      detail: criticalRisks ? 'escalate before proposal' : 'manageable with owner follow-up',
      progress: Math.max(8, 100 - criticalRisks * 26 - openRisks * 7),
      tone: criticalRisks ? 'tomato' : openRisks ? 'amber' : 'jade',
    },
  ];

  return (
    <motion.section
      className="command-center"
      role="region"
      aria-label="BidStack command center"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={springSoft}
    >
      <div className="command-center-hero">
        <div className="command-center-orbit" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="command-center-kicker">
          <Icon name="sparkle" size={14} />
          <span>BidStack command center</span>
        </div>
        <h2>{cockpit.company.name}</h2>
        <p>{nextMove}</p>
        <div className="command-center-actions" aria-label="Account decision signals">
          <Badge tone={readiness >= 85 ? 'jade' : 'blue'}>{readiness}% ready</Badge>
          <Badge tone={healthTone(cockpit.health.band)}>{labelForBand(cockpit.health.band)}</Badge>
          <Badge tone={stackCount >= 12 ? 'purple' : 'gray'}>{stackCount} stack signals</Badge>
        </div>
      </div>

      <div className="command-center-metrics">
        {signals.map((signal, index) => (
          <motion.div
            key={signal.label}
            className="command-signal"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.045 }}
          >
            <div className="command-signal-head">
              <span>{signal.label}</span>
              <Badge tone={signal.tone}>{signal.detail}</Badge>
            </div>
            <strong>
              <AnimatedMetric value={signal.value} />
            </strong>
            <span className="command-progress" aria-hidden>
              <motion.span
                initial={{ width: reducedMotion ? `${signal.progress}%` : '0%' }}
                animate={{ width: `${signal.progress}%` }}
                transition={{ ...springSnap, delay: reducedMotion ? 0 : 0.14 + index * 0.04 }}
              />
            </span>
          </motion.div>
        ))}
      </div>

      <div className="command-center-footer">
        <div>
          <span>Primary commercial signal</span>
          <strong>
            {primaryKpi ? `${primaryKpi.label}: ${primaryKpi.value}` : 'Pipeline pending'}
          </strong>
        </div>
        <div>
          <span>Weighted account value</span>
          <strong>
            {cockpit.company.annualRevenueMicros
              ? formatMoneyMicros(cockpit.company.annualRevenueMicros, 'EUR')
              : 'Not verified'}
          </strong>
        </div>
        <div>
          <span>Decision owner map</span>
          <strong>{committee.contacts} contacts mapped</strong>
        </div>
      </div>
    </motion.section>
  );
});

function deriveReadiness(cockpit: AccountCockpitSnapshot): number {
  const health = cockpit.health.score;
  const compliance =
    cockpit.compliance.length === 0
      ? 54
      : (cockpit.compliance.filter((item) => item.status === 'compliant').length /
          cockpit.compliance.length) *
        100;
  const sources = Math.min(100, (cockpit.company.sourceAttribution.length + 1) * 18);
  const contacts = Math.min(
    100,
    cockpit.keyContacts.reduce((acc, person) => acc + (person.influence ?? 1), 0) * 12,
  );
  const riskPenalty = cockpit.risks.reduce((acc, risk) => acc + riskPenaltyFor(risk), 0);
  return clamp(
    Math.round(health * 0.34 + compliance * 0.26 + sources * 0.2 + contacts * 0.2 - riskPenalty),
  );
}

function deriveNextMove(cockpit: AccountCockpitSnapshot): string {
  const blocker = cockpit.compliance.find((item) => item.status === 'blocked');
  if (blocker) return `Unblock ${blocker.label} before the bid gate.`;

  const urgentRisk = cockpit.risks.find(
    (risk) =>
      risk.status !== 'mitigated' && (risk.severity === 'critical' || risk.severity === 'high'),
  );
  if (urgentRisk) {
    const owner = urgentRisk.owner ? ` with ${urgentRisk.owner}` : '';
    return `Escalate ${urgentRisk.title}${owner} before proposal approval.`;
  }

  const champion = cockpit.keyContacts.find((person) => person.roleInDecision === 'champion');
  if (champion) return `Use ${champion.name} as champion for the next presales milestone.`;

  if (cockpit.company.sourceAttribution.length < 3) {
    return 'Refresh data verification to strengthen legal, logo, market, and account-source proof.';
  }

  return 'Advance the next proposal step with available account context and owner alignment.';
}

function deriveCommittee(cockpit: AccountCockpitSnapshot): {
  contacts: number;
  influence: number;
  summary: string;
} {
  const contacts = cockpit.keyContacts.length;
  const influence = Math.min(
    5,
    Math.max(
      1,
      Math.round(cockpit.keyContacts.reduce((acc, person) => acc + (person.influence ?? 1), 0) / 2),
    ),
  );
  const champions = cockpit.keyContacts.filter(
    (person) => person.roleInDecision === 'champion',
  ).length;
  const buyers = cockpit.keyContacts.filter((person) => person.roleInDecision === 'buyer').length;
  const summary =
    champions > 0
      ? `${champions} champion${champions === 1 ? '' : 's'} mapped`
      : buyers > 0
        ? `${buyers} buyer${buyers === 1 ? '' : 's'} mapped`
        : contacts > 0
          ? `${contacts} stakeholder${contacts === 1 ? '' : 's'} mapped`
          : 'map buyer and champion';
  return { contacts, influence, summary };
}

function riskPenaltyFor(risk: RiskItem): number {
  if (risk.status === 'mitigated' || risk.status === 'accepted') return 0;
  if (risk.severity === 'critical') return 14;
  if (risk.severity === 'high') return 9;
  if (risk.severity === 'medium') return 4;
  return 1;
}

function healthTone(band: AccountCockpitSnapshot['health']['band']): BadgeTone {
  if (band === 'strong') return 'jade';
  if (band === 'good') return 'blue';
  if (band === 'needs_attention') return 'amber';
  return 'tomato';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
