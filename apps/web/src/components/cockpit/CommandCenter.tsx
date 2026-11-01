import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import type { BadgeTone } from '@/components/ui/Badge';
import { springSnap, springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, RiskItem } from '@bidstack/shared';

import { isOpenRisk } from './open-risk-headline';

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
  const riskLoad = openRiskFigures(cockpit);
  const openRisks = riskLoad.openCount;
  const criticalRisks = riskLoad.criticalOnPage;
  const attributionCount = cockpit.company.sourceAttribution.length;
  const hasLogo = Boolean(cockpit.company.logo);
  const proofCount = sourceReceiptTotal(attributionCount, hasLogo);

  const signals: CommandSignal[] = [
    {
      label: t('commandCenter.signal.readiness.label', 'Bid readiness proxy'),
      value: `${readiness}%`,
      detail: t(
        cockpit.registerDealsCapped
          ? 'commandCenter.signal.readiness.detailDealPage'
          : 'commandCenter.signal.readiness.detail',
        readinessDetailFallback(cockpit.registerDealsCapped),
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
      value: riskLoad.noneRecorded
        ? t('commandCenter.signal.risk.valueNone', 'None recorded')
        : riskLoad.unseenOpen
          ? t('commandCenter.signal.risk.valueOpen', '{{count}} open', { count: openRisks })
          : criticalRisks
            ? t('commandCenter.signal.risk.valueHigh', '{{count}} high', { count: criticalRisks })
            : t('commandCenter.signal.risk.valueOpen', '{{count}} open', { count: openRisks }),
      detail: riskLoad.noneRecorded
        ? t('commandCenter.signal.risk.detailNone', 'no risk rows on this account')
        : riskLoad.unseenOpen
          ? t('commandCenter.signal.risk.detailPage', 'latest 50 open risks')
          : criticalRisks
            ? t('commandCenter.signal.risk.detailEscalate', 'escalate before proposal')
            : openRisks
              ? t('commandCenter.signal.risk.detailManageable', 'manageable with owner follow-up')
              : t('commandCenter.signal.risk.detailNoneOpen', 'recorded register has no open risks'),
      progress: riskLoad.noneRecorded ? null : riskLoadProgress(openRisks, riskLoad.unseenOpen ? 0 : criticalRisks),
      tone: riskLoad.noneRecorded ? 'amber' : riskLoad.unseenOpen || criticalRisks ? 'tomato' : openRisks ? 'amber' : 'jade',
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
      <p className="command-center-next">{nextMove}</p>
    </motion.section>
  );
});

function deriveReadiness(cockpit: AccountCockpitSnapshot): number {
  const health = cockpit.health.score;
  const compliance = complianceShare(cockpit);
  const sources = Math.min(
    100,
    sourceReceiptTotal(cockpit.company.sourceAttribution.length, Boolean(cockpit.company.logo)) * 18,
  );
  const contacts = Math.min(
    100,
    cockpit.keyContacts.reduce((acc, person) => acc + (person.influence ?? 0), 0) * 12,
  );
  const riskPenalty = riskPenaltyFromRegister(cockpit);
  return clamp(
    Math.round(health * 0.34 + compliance * 0.26 + sources * 0.2 + contacts * 0.2 - riskPenalty),
  );
}

/** The six cards are a sample. Counts are the checks on the loaded deals. */
export function complianceShare(input: {
  compliance: readonly { status: string | null }[];
  compliantCount?: number;
  complianceTotal?: number;
}): number {
  if (input.complianceTotal != null && input.compliantCount != null) {
    if (input.complianceTotal === 0) return 0;
    return (input.compliantCount / input.complianceTotal) * 100;
  }
  if (input.compliance.length === 0) return 0;
  return (
    (input.compliance.filter((item) => item.status === 'compliant').length /
      input.compliance.length) *
    100
  );
}

const SEVERITY_PENALTY = { critical: 14, high: 9, medium: 4, low: 1 } as const;

/** Open risks on the loaded deals, not the six rows on the card. */
export function riskPenaltyFromRegister(input: {
  risks: readonly RiskItem[];
  openRiskSeverity?: { critical: number; high: number; medium: number; low: number };
}): number {
  const counted = input.openRiskSeverity;
  if (counted) {
    return (
      counted.critical * SEVERITY_PENALTY.critical +
      counted.high * SEVERITY_PENALTY.high +
      counted.medium * SEVERITY_PENALTY.medium +
      counted.low * SEVERITY_PENALTY.low
    );
  }
  return input.risks.reduce((acc, risk) => acc + riskPenaltyFor(risk), 0);
}

/** Blocked checks on the loaded deals that the six cards do not show. */
export function unseenBlockedCount(input: {
  compliance: readonly { status: string | null }[];
  blockedCount?: number;
}): number {
  if (input.blockedCount == null) return 0;
  const shown = input.compliance.filter((item) => item.status === 'blocked').length;
  return Math.max(0, input.blockedCount - shown);
}

/** Open critical and high risks on the loaded deals that the six cards do not show. */
export function unseenHighSeverityCount(input: {
  risks: readonly { status: string; severity: string | null }[];
  openRiskSeverity?: { critical: number; high: number };
}): number {
  if (!input.openRiskSeverity) return 0;
  const shown = input.risks.filter(
    (risk) =>
      (risk.status === 'open' || risk.status === 'in_progress') &&
      (risk.severity === 'critical' || risk.severity === 'high'),
  ).length;
  return Math.max(0, input.openRiskSeverity.critical + input.openRiskSeverity.high - shown);
}

/** A full opportunity page means the register counts skip older deals. */
export function readinessDetailFallback(registerDealsCapped?: boolean): string {
  return registerDealsCapped
    ? 'weighted mix of checks on the latest 1,000 opportunities, not the whole account'
    : 'weighted mix of recorded signals on this account, not a measured score';
}

export function deriveNextMove(cockpit: AccountCockpitSnapshot, t: TFunction): string {
  const blocker = cockpit.compliance.find((item) => item.status === 'blocked');
  if (blocker)
    return t('commandCenter.nextMove.unblock', 'Unblock {{label}} before the bid gate.', {
      label: blocker.label,
    });

  const urgentRisk = cockpit.risks.find(
    (risk) =>
      isOpenRisk(risk.status) && (risk.severity === 'critical' || risk.severity === 'high'),
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

  const blockedPastCards = unseenBlockedCount(cockpit);
  if (blockedPastCards > 0) {
    return t(
      'commandCenter.nextMove.reviewUnseenBlocked',
      'Blocked checks past the six shown: {{count}}. Unblock them before the bid gate.',
      { count: blockedPastCards },
    );
  }

  const highPastCards = unseenHighSeverityCount(cockpit);
  if (highPastCards > 0) {
    return t(
      'commandCenter.nextMove.reviewUnseenHigh',
      'Open high-severity risks past the six shown: {{count}}. Review them before proposal approval.',
      { count: highPastCards },
    );
  }

  if (openRiskFigures(cockpit).unseenOpen) {
    return t(
      'commandCenter.nextMove.reviewRegister',
      'Review open risks past the latest 50 before proposal approval.',
    );
  }

  if (cockpit.buyingRolesCapped) {
    return t(
      'commandCenter.nextMove.buyingRoles',
      'Buying-role evidence stopped at 200 accepted facts. Confirm the champion before the next milestone.',
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

/** Open-risk tile figures. A full page is not "none recorded". */
export function openRiskFigures(cockpit: {
  risks: readonly RiskItem[];
  openRiskCount?: number;
  risksCapped?: boolean;
}): { noneRecorded: boolean; openCount: number; criticalOnPage: number; unseenOpen: boolean } {
  const shownOpen = cockpit.risks.filter(
    (risk) => risk.status === 'open' || risk.status === 'in_progress',
  ).length;
  const openCount = cockpit.openRiskCount ?? shownOpen;
  const criticalOnPage = cockpit.risks.filter(
    (risk) =>
      isOpenRisk(risk.status) && (risk.severity === 'critical' || risk.severity === 'high'),
  ).length;
  const unseenOpen = Boolean(
    cockpit.risksCapped && cockpit.openRiskCount != null && cockpit.openRiskCount > shownOpen,
  );
  return {
    noneRecorded: cockpit.risks.length === 0 && openCount === 0 && !cockpit.risksCapped,
    openCount,
    criticalOnPage,
    unseenOpen,
  };
}

/** Bar fill follows open load. Zero open risks is an empty bar. */
export function riskLoadProgress(openRisks: number, criticalRisks: number): number {
  return Math.min(100, criticalRisks * 26 + openRisks * 7);
}

function riskPenaltyFor(risk: RiskItem): number {
  if (!isOpenRisk(risk.status)) return 0;
  if (risk.severity == null) return 0;
  return SEVERITY_PENALTY[risk.severity];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
